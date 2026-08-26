import { createRequire } from "module";
import S3Manager from "./s3.js";
import { readPptxSlides } from "./thumbnails.js";
import { getRedis } from "./redis.js";
import logger from "./logger.js";

/**
 * A document's full text, split into labelled segments.
 *
 * The processing pipeline extracts text and throws it away once the metadata is
 * generated, so this extracts again from the same S3 object. It runs once per
 * document: the result is chunked and persisted by documentIndex, which is
 * where every later question reads from.
 *
 * Segments carry a label when the file format really provides one - a PDF page,
 * a slide, a sheet - so an answer can cite where it came from. Formats with no
 * such structure (docx has no fixed pages, csv is one table) return a single
 * unlabelled segment rather than a made-up page number.
 *
 * Deliberately no OCR. A scanned PDF takes tens of seconds per page in the
 * pipeline; doing that inside a request would hang the panel. Those documents
 * report "no readable text" instead.
 */

const require = createRequire(import.meta.url);

let pdfParse;
try {
  const rawPdfParse = require("pdf-parse");
  pdfParse = rawPdfParse.default || rawPdfParse;
} catch (error) {
  logger.error("documentText: failed to load pdf-parse:", error);
  pdfParse = null;
}

// Ceiling on how much text one document contributes. ~600k characters is on the
// order of a 1,500-page book; past that the indexing cost stops being worth it.
const MAX_EXTRACT_CHARS = 600_000;

// Below this, extraction effectively failed: an image-only PDF, an empty
// spreadsheet, a deck of nothing but pictures.
const MIN_USABLE_CHARS = 40;

const MAX_SLIDES = 500;

// Re-parsing a 300-page scan on every question, only to conclude again that it
// has no text, is the one result worth remembering.
const UNREADABLE_TTL_SECONDS = 6 * 3600;

function normalize(raw) {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * pdf-parse concatenates pages as `text + "\n\n" + pageText`, and its page
 * renderer only ever joins lines with a single "\n". So a clean extraction
 * splits on "\n\n" into exactly one empty leading piece plus one piece per
 * page.
 *
 * That does not always hold - an empty text item can produce a stray blank
 * line - so the count is checked against numpages. When it does not match, the
 * boundaries are not trustworthy, and no page labels are better than wrong
 * ones on every citation.
 *
 * @returns {string[]|null} one string per page, or null if unverifiable.
 */
export function splitPdfPages(rawText, numpages) {
  const pages = String(rawText || "").split("\n\n");

  if (pages[0] === "") pages.shift();

  return numpages && pages.length === numpages ? pages : null;
}

async function extractPdf(buffer) {
  if (!pdfParse) return [];

  const data = await pdfParse(buffer);
  const raw = String(data?.text || "");
  const pages = splitPdfPages(raw, data?.numpages);

  if (pages) {
    return pages.map((text, position) => ({
      label: `Page ${position + 1}`,
      text: normalize(text),
    }));
  }

  logger.info(
    `PDF page boundaries unreliable for ${data?.numpages} pages; indexing without page labels`,
  );

  return [{ label: null, text: normalize(raw) }];
}

async function extractDocx(buffer) {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer });

  // A .docx has no page breaks until something renders it, so there is no
  // honest page label to attach here.
  return [{ label: null, text: normalize(value) }];
}

async function extractPptx(buffer) {
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs/promises");

  // readPptxSlides reads a zip from disk, so the buffer lands in a temp file.
  const tmpPath = path.join(
    os.tmpdir(),
    `asktext-${Date.now()}-${Math.random().toString(16).slice(2)}.pptx`,
  );

  try {
    await fs.writeFile(tmpPath, buffer);
    const slides = await readPptxSlides(tmpPath, MAX_SLIDES);

    return slides.map((texts, position) => ({
      label: `Slide ${position + 1}`,
      text: normalize(texts.join("\n")),
    }));
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

async function extractXlsx(buffer) {
  const XLSX = (await import("xlsx")).default;
  const workbook = XLSX.read(buffer, { type: "buffer" });

  return workbook.SheetNames.map((name) => ({
    label: `Sheet: ${name}`,
    text: normalize(XLSX.utils.sheet_to_csv(workbook.Sheets[name])),
  }));
}

function parse(buffer, fileType) {
  switch (fileType) {
    case "pdf":
      return extractPdf(buffer);
    case "docx":
      return extractDocx(buffer);
    case "pptx":
      return extractPptx(buffer);
    case "xlsx":
      return extractXlsx(buffer);
    case "csv":
      return [{ label: null, text: normalize(buffer.toString("utf8")) }];
    default:
      return [];
  }
}

async function extract(document) {
  // Outside the try: a storage failure is transient and must stay an error the
  // caller reports, not be mistaken for a document with no text.
  const buffer = await S3Manager.getObjectBuffer(document.s3Path);

  try {
    return await parse(buffer, document.fileType);
  } catch (error) {
    // A file the parser cannot read - a truncated upload, a corrupt PDF whose
    // page dictionary is invalid - will fail identically every time. Treating
    // it as "no readable text" gets the honest message to the user and stops
    // the work being repeated on every question.
    logger.error(
      `Ask AI: could not parse ${document.fileType} ${document._id}:`,
      error,
    );
    return [];
  }
}

/** Trims the segment list to the extraction ceiling, mid-segment if need be. */
function applyCeiling(segments) {
  const kept = [];
  let used = 0;

  for (const segment of segments) {
    if (used >= MAX_EXTRACT_CHARS) return { segments: kept, truncated: true };

    const room = MAX_EXTRACT_CHARS - used;
    const text =
      segment.text.length > room ? segment.text.slice(0, room) : segment.text;

    kept.push({ ...segment, text });
    used += text.length;
  }

  return { segments: kept, truncated: false };
}

/**
 * @returns {Promise<{segments: Array<{label: string|null, text: string}>,
 *                    totalChars: number, truncated: boolean}|null>}
 *   null when the document holds no text we can read.
 */
export async function extractDocumentSegments(document) {
  const cacheKey = `doctext:unreadable:${document._id}`;
  const redis = getRedis();

  if (redis) {
    try {
      if (await redis.get(cacheKey)) return null;
    } catch (error) {
      logger.error(`Unreadable-text cache read failed for ${document._id}:`, error);
    }
  }

  const segments = (await extract(document)).filter((segment) => segment.text);
  const totalChars = segments.reduce(
    (sum, segment) => sum + segment.text.length,
    0,
  );

  if (totalChars < MIN_USABLE_CHARS) {
    if (redis) {
      try {
        await redis.setEx(cacheKey, UNREADABLE_TTL_SECONDS, "1");
      } catch (error) {
        logger.error(
          `Unreadable-text cache write failed for ${document._id}:`,
          error,
        );
      }
    }
    return null;
  }

  const { segments: bounded, truncated } = applyCeiling(segments);

  return {
    segments: bounded,
    totalChars: Math.min(totalChars, MAX_EXTRACT_CHARS),
    truncated,
  };
}

export async function forgetUnreadable(documentId) {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(`doctext:unreadable:${documentId}`);
  } catch (error) {
    logger.error(`Unreadable-text cache clear failed for ${documentId}:`, error);
  }
}
