import { tmpdir } from "os";
import { join } from "path";
import Document from "../models/Document.js";
import DocumentChunk from "../models/DocumentChunk.js";
import S3Manager from "./s3.js";
import { ocrPdfPages } from "./documentProcessor.js";
import {
  chunkSegments,
  dropCachedPassages,
  INDEX_FORMAT,
} from "./documentIndex.js";
import logger from "./logger.js";

/**
 * Reading a scanned document for Ask AI.
 *
 * A PDF of page images extracts no text at all, so the panel used to say the
 * document could not be answered about - which is true of the text layer and
 * false of the document. The processing pipeline already OCRs such files, but
 * only the first three pages and only to generate metadata, which it then
 * throws away.
 *
 * This runs the same Tesseract OCR page by page as a queued job, turning each
 * page into passages labelled with its real page number, and saving as it goes.
 * A page takes seconds, so:
 *   - each pass is time-boxed and the job asks to be run again,
 *   - progress is recorded per page and resumed, never repeated,
 *   - the document becomes answerable from the pages read so far rather than
 *     after all of them.
 */

// A hard ceiling on pages per document. Tesseract is 5-15 seconds a page on a
// small instance, so an uncapped 500-page scan would occupy a worker for hours
// to answer questions nobody asked. Env-tunable like the pipeline's own OCR.
const MAX_PAGES = parseInt(process.env.ASK_OCR_MAX_PAGES, 10) || 60;

// Higher than the pipeline's 1.2. That scale is about 110 DPI, which is enough
// for a title but loses accuracy on body text, and this text is what answers
// are built from.
const SCALE = parseFloat(process.env.ASK_OCR_SCALE) || 2;

// One pass of work before reporting back. Long enough to make real progress,
// short enough that the job stays observable and other work gets a turn.
const PASS_BUDGET_MS = 60_000;

/** Only PDFs can be OCR'd, and only when OCR is switched on at all. */
export function isOcrCandidate(document) {
  return document?.fileType === "pdf" && process.env.DISABLE_OCR !== "true";
}

/**
 * How far OCR has got, judged against the page cap rather than the page count.
 *
 * A 300-page scan is finished at page 60, and comparing against 300 would leave
 * it "in progress" forever - re-queueing the job on every panel open and
 * telling the reader it is still working when it has stopped.
 */
export function ocrProgress(aiIndex) {
  const ocr = aiIndex?.ocr;
  if (!ocr) return null;

  const pagesDone = ocr.pagesDone || 0;
  const totalPages = ocr.totalPages || 0;
  const pagesTarget = totalPages ? Math.min(totalPages, MAX_PAGES) : 0;

  return {
    pagesDone,
    totalPages,
    pagesTarget,
    // An unknown page count means the first pass has not reported yet.
    complete: pagesTarget > 0 && pagesDone >= pagesTarget,
  };
}

async function downloadToTemp(s3Path) {
  const fs = await import("fs");
  const buffer = await S3Manager.getObjectBuffer(s3Path);
  const tmpPath = join(
    tmpdir(),
    `askocr-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`,
  );

  await fs.promises.writeFile(tmpPath, buffer);
  return tmpPath;
}

/**
 * One OCR pass. Picks up at the first page not yet read and stops on the time
 * budget or the page cap.
 *
 * @returns {Promise<{complete: boolean, pagesDone: number, totalPages: number,
 *                    chunkCount: number}>}
 */
export async function ocrDocumentIntoChunks(documentId) {
  const document = await Document.findById(documentId).select(
    "aiIndex s3Path fileType",
  );

  if (!document || !document.s3Path || !isOcrCandidate(document)) {
    return { complete: true, pagesDone: 0, totalPages: 0, chunkCount: 0 };
  }

  const startedAt = Date.now();
  const deadline = startedAt + PASS_BUDGET_MS;

  let pagesDone = document.aiIndex?.ocr?.pagesDone || 0;
  let totalPages = document.aiIndex?.ocr?.totalPages || 0;
  let totalChars = document.aiIndex?.totalChars || 0;

  // Counted rather than taken from aiIndex: a pass that inserted a page's
  // passages and then died before recording progress would otherwise reuse
  // those indexes and collide with itself on the unique {documentId, index}.
  let chunkCount = await DocumentChunk.countDocuments({
    documentId: document._id,
  });

  if (pagesDone >= MAX_PAGES) {
    return { complete: true, pagesDone, totalPages, chunkCount };
  }

  const filePath = await downloadToTemp(document.s3Path);

  try {
    const result = await ocrPdfPages(filePath, {
      startPage: pagesDone + 1,
      maxPages: MAX_PAGES - pagesDone,
      scale: SCALE,
      shouldStop: () => Date.now() > deadline,
      onPage: async ({ page, text, totalPages: pages }) => {
        totalPages = pages;

        if (text) {
          const chunks = chunkSegments([{ label: `Page ${page}`, text }]);

          if (chunks.length) {
            try {
              await DocumentChunk.insertMany(
                chunks.map((chunk, position) => ({
                  documentId: document._id,
                  // Continues the document's existing numbering, so reading
                  // order still matches the page order.
                  index: chunkCount + position,
                  text: chunk.text,
                  label: chunk.label,
                })),
                { ordered: false },
              );
            } catch (error) {
              // These passages are already stored - a pass wrote them before
              // it recorded the page. Nothing to redo, and losing the whole
              // book over it would be absurd.
              if (error.code !== 11000 && !error.writeErrors) throw error;
            }

            chunkCount += chunks.length;
            totalChars += text.length;
          }
        }

        // Written per page, so a crash or a deploy costs one page, not the run.
        // format is stamped here too: without it the index looks stale and the
        // next question would throw away everything OCR has read.
        await Document.updateOne(
          { _id: document._id },
          {
            $set: {
              "aiIndex.chunkCount": chunkCount,
              "aiIndex.totalChars": totalChars,
              "aiIndex.truncated": pages > MAX_PAGES,
              "aiIndex.ocr": { pagesDone: page, totalPages: pages },
              "aiIndex.format": INDEX_FORMAT,
              "aiIndex.builtAt": new Date(),
            },
          },
        );

        pagesDone = page;
        // New pages are not in the cached copy, and answers should use them.
        dropCachedPassages(document._id);
      },
    });

    const lastPage = Math.min(result.totalPages, MAX_PAGES);
    const complete = pagesDone >= lastPage;

    logger.info(
      `Ask AI OCR ${document._id}: pages ${pagesDone}/${lastPage} ` +
        `(of ${result.totalPages} in the file), ${chunkCount} passages, ` +
        `${Date.now() - startedAt}ms this pass`,
    );

    return { complete, pagesDone, totalPages: result.totalPages, chunkCount };
  } finally {
    const fs = await import("fs");
    await fs.promises.unlink(filePath).catch(() => {});
  }
}
