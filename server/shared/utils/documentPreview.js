import S3Manager from "./s3.js";
import { readPptxSlides, parseCsvRows } from "./thumbnails.js";
import { getRedis } from "./redis.js";
import logger from "./logger.js";

/**
 * Structured, renderable content for the in-app viewer.
 *
 * The viewer used to hand DOCX/PPTX/XLSX to a third-party iframe (Office Live
 * on desktop, Google gview on mobile) and parse CSV in the browser with
 * text.split(","), which broke on any quoted comma. Both are replaced by this:
 * the server extracts once, the client renders React.
 *
 * PDFs never come through here - they are rendered natively from the signed S3
 * URL by react-pdf.
 */

const CACHE_TTL_SECONDS = 3600;

// Bounds so one enormous file cannot pin memory or ship a 50MB JSON payload.
const MAX_PARAGRAPHS = 2000;
const MAX_SHEET_ROWS = 2000;
const MAX_SHEET_COLUMNS = 60;
const MAX_SLIDES = 200;
const MAX_CELL_LENGTH = 500;

function clampCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return text.length > MAX_CELL_LENGTH
    ? `${text.slice(0, MAX_CELL_LENGTH)}…`
    : text;
}

function clampRows(rows) {
  const truncatedRows = rows.length > MAX_SHEET_ROWS;
  const limited = rows.slice(0, MAX_SHEET_ROWS).map((row) => {
    const cells = Array.isArray(row) ? row : [row];
    return cells.slice(0, MAX_SHEET_COLUMNS).map(clampCell);
  });

  return { rows: limited, truncatedRows, totalRows: rows.length };
}

async function buildDocxPreview(buffer) {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer });

  const paragraphs = String(value || "")
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return {
    kind: "text",
    paragraphs: paragraphs.slice(0, MAX_PARAGRAPHS),
    truncated: paragraphs.length > MAX_PARAGRAPHS,
  };
}

async function buildPptxPreview(buffer) {
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs/promises");

  // readPptxSlides reads a zip from disk, so the buffer lands in a temp file.
  const tmpPath = path.join(
    os.tmpdir(),
    `preview-${Date.now()}-${Math.random().toString(16).slice(2)}.pptx`
  );

  try {
    await fs.writeFile(tmpPath, buffer);
    const slides = await readPptxSlides(tmpPath, MAX_SLIDES);

    return {
      kind: "slides",
      slides: slides.map((texts) => ({
        title: texts[0] || "",
        body: texts.slice(1, 40),
      })),
    };
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

async function buildXlsxPreview(buffer) {
  const XLSX = (await import("xlsx")).default;
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    sheetRows: MAX_SHEET_ROWS,
  });

  const sheets = workbook.SheetNames.slice(0, 20).map((name) => {
    const raw = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      blankrows: false,
      defval: "",
    });
    return { name, ...clampRows(raw) };
  });

  return { kind: "sheet", sheets };
}

function buildCsvPreview(buffer) {
  const text = buffer.toString("utf8");
  // The full RFC 4180 reader, so quoted commas and embedded newlines survive.
  const raw = parseCsvRows(text, MAX_SHEET_ROWS + 1);

  return { kind: "sheet", sheets: [{ name: null, ...clampRows(raw) }] };
}

async function build(document) {
  const buffer = await S3Manager.getObjectBuffer(document.s3Path);

  switch (document.fileType) {
    case "docx":
      return buildDocxPreview(buffer);
    case "pptx":
      return buildPptxPreview(buffer);
    case "xlsx":
      return buildXlsxPreview(buffer);
    case "csv":
      return buildCsvPreview(buffer);
    default:
      return { kind: "unsupported" };
  }
}

/**
 * Extraction means pulling the whole file out of S3 and parsing it, so the
 * result is cached. A document's bytes never change after processing, so the
 * only invalidation needed is a reprocess (which rewrites the same content).
 */
export async function getDocumentPreview(document) {
  if (document.fileType === "pdf") {
    return { kind: "pdf" };
  }

  const cacheKey = `preview:${document._id}`;
  const redis = getRedis();

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (error) {
      logger.error(`Preview cache read failed for ${document._id}:`, error);
    }
  }

  const preview = await build(document);

  if (redis) {
    try {
      await redis.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(preview));
    } catch (error) {
      logger.error(`Preview cache write failed for ${document._id}:`, error);
    }
  }

  return preview;
}

export async function invalidateDocumentPreview(documentId) {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(`preview:${documentId}`);
  } catch (error) {
    logger.error(`Preview cache invalidation failed for ${documentId}:`, error);
  }
}
