// Core orchestrator for the Automated Document Fetcher.
//
// fetchDocuments() routes a platform category to one or more source adapters,
// searches them for openly-licensed documents, downloads candidates to a temp
// dir, de-duplicates them (within the batch and against the DB), uploads each
// to S3, creates a Document record, and enqueues the existing
// "process-document" worker to do metadata generation / thumbnails / etc.
//
// It does NOT call the AI metadata generator directly — that is the job of the
// downstream processDocument() worker.
import crypto from "crypto";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";

import S3Manager from "../s3.js";
import Document from "../../models/Document.js";
import User from "../../models/User.js";
import { enqueueProcessing } from "../../queues/processQueue.js";
import logger from "../logger.js";
import { resolveAdapters } from "./categoryMap.js";

import * as gutenberg from "./adapters/gutenberg.js";
import * as arxiv from "./adapters/arxiv.js";
import * as pubmed from "./adapters/pubmed.js";
import * as archive from "./adapters/archive.js";
import * as openstax from "./adapters/openstax.js";

const ADAPTERS = { gutenberg, arxiv, pubmed, archive, openstax };

// Allowed download extensions. NOTE: kept in sync with the Document.fileType
// enum (pdf/docx/pptx/xlsx/csv) — .epub is intentionally excluded because the
// schema and processing pipeline do not support it.
const ALLOWED_EXT = ["pdf", "docx", "pptx", "csv", "xlsx"];

const MIN_BYTES = 10 * 1024; // 10 KB
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const DOWNLOAD_TIMEOUT_MS = 60_000;

const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the owner user id for fetched documents. Prefers an explicitly
 * requested id (e.g. the admin who triggered the fetch), then
 * FETCHER_SYSTEM_USER_ID, then falls back to the first admin user in the DB.
 * @param {string} [requestedBy]
 * @returns {Promise<string|null>}
 */
export async function resolveOwnerId(requestedBy) {
  if (requestedBy) return requestedBy;
  if (process.env.FETCHER_SYSTEM_USER_ID) return process.env.FETCHER_SYSTEM_USER_ID;
  const admin = await User.findOne({ role: "admin" }).select("_id").lean();
  return admin ? admin._id.toString() : null;
}

function userAgent() {
  return `DocsDB-Fetcher/1.0 (contact: ${
    process.env.FETCHER_CONTACT_EMAIL || "unknown"
  })`;
}

// --- Per-adapter rate limiter (max 1 request / second / adapter) ------------
const lastCallAt = {};
async function rateLimit(adapter) {
  const wait = 1000 - (Date.now() - (lastCallAt[adapter] || 0));
  if (wait > 0) await sleep(wait);
  lastCallAt[adapter] = Date.now();
}

function extFromCandidate(candidate) {
  if (candidate.format && ALLOWED_EXT.includes(candidate.format.toLowerCase())) {
    return candidate.format.toLowerCase();
  }
  const m = (candidate.url || "").split("?")[0].match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

function safeFilename(title, ext) {
  const base = (title || "document")
    .replace(/[^a-z0-9\-_ ]/gi, "")
    .replace(/\s+/g, "_")
    .slice(0, 120);
  return `${base || "document"}.${ext}`;
}

// Download a URL to a buffer with one retry on network failure.
async function downloadToBuffer(url, adapter) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await rateLimit(adapter);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent() },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!res.ok) {
        // Cancel rather than abandon: an unread body holds the connection open
        // until GC.
        await res.body?.cancel?.().catch(() => {});
        throw new Error(`HTTP ${res.status}`);
      }

      // The MAX_BYTES check downstream only runs *after* the whole response has
      // been materialised, so a mislabelled or hostile URL could buffer
      // gigabytes first. Reject on the advertised length before reading.
      const advertised = Number(res.headers.get("content-length"));
      if (Number.isFinite(advertised) && advertised > MAX_BYTES) {
        await res.body?.cancel?.().catch(() => {});
        throw new Error(`Response too large: ${advertised} bytes`);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) {
        throw new Error(`Response too large: ${buf.length} bytes`);
      }
      return buf;
    } catch (err) {
      lastErr = err;
      if (attempt === 1) {
        logger.warn(
          `[fetcher] download retry for ${url} (${adapter}): ${err.message}`
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Fetch documents for a category and feed them into the upload pipeline.
 *
 * @param {object}   opts
 * @param {string}   opts.category    platform category enum value
 * @param {number}   opts.count       number of documents to ingest (1-100)
 * @param {string}   opts.userId      owner user id for created Documents
 * @param {Function} [opts.onProgress] progress callback
 * @returns {Promise<{documents: Array, tmpDir: string}>}
 */
export async function fetchDocuments({ category, count, userId, onProgress = () => {} }) {
  if (!userId) throw new Error("fetchDocuments requires a userId");

  const adapters = resolveAdapters(category);
  const tmpDir = path.join(os.tmpdir(), `docsdb-fetcher-${uuidv4()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const documents = [];

  try {
    // --- 1. Gather candidates across adapters (in priority order) ----------
    const seenSourceIds = new Set();
    const candidates = [];

    for (const adapter of adapters) {
      if (candidates.length >= count) break;
      const fn = ADAPTERS[adapter]?.search;
      if (!fn) {
        logger.warn(`[fetcher] unknown adapter "${adapter}" — skipping`);
        continue;
      }

      onProgress({ stage: "searching", source: adapter, current: candidates.length, total: count });

      let results = [];
      try {
        await rateLimit(adapter);
        results = await fn(category, count);
      } catch (err) {
        // A single adapter failing must never abort the whole job.
        logger.error(`[fetcher] adapter "${adapter}" search failed: ${err.message}`);
        onProgress({ stage: "error", source: adapter, error: err.message });
        continue;
      }

      for (const r of results) {
        if (candidates.length >= count) break;
        if (!r?.url || !r?.id) continue;
        if (seenSourceIds.has(r.id)) continue;
        seenSourceIds.add(r.id);

        // Pre-download DB de-dup: skip anything we already ingested.
        const existing = await Document.findOne({
          sourceName: adapter,
          sourceId: r.id,
        }).select("_id");
        if (existing) {
          onProgress({ stage: "skipped", source: adapter, title: r.title, url: r.url });
          continue;
        }

        candidates.push({ ...r, source: adapter });
      }
    }

    // --- 2. Download, validate, de-dup, upload, enqueue --------------------
    const batchHashes = new Set();

    for (const candidate of candidates) {
      if (documents.length >= count) break;

      const { source, title, url } = candidate;
      const ext = extFromCandidate(candidate);

      if (!ext || !ALLOWED_EXT.includes(ext)) {
        onProgress({ stage: "skipped", source, title, url, error: `unsupported type "${ext}"` });
        continue;
      }

      onProgress({
        stage: "downloading",
        source,
        title,
        url,
        current: documents.length,
        total: count,
      });

      let buffer;
      try {
        buffer = await downloadToBuffer(url, source);
      } catch (err) {
        logger.error(`[fetcher] download failed (skipped) ${url}: ${err.message}`);
        onProgress({ stage: "error", source, title, url, error: err.message });
        continue;
      }

      // Size gate.
      if (buffer.length < MIN_BYTES || buffer.length > MAX_BYTES) {
        onProgress({
          stage: "skipped",
          source,
          title,
          url,
          error: `size ${(buffer.length / 1024).toFixed(0)}KB out of range`,
        });
        continue;
      }

      // Content hash.
      const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

      // De-dup within this batch.
      if (batchHashes.has(fileHash)) {
        onProgress({ stage: "skipped", source, title, url, error: "duplicate in batch" });
        continue;
      }

      // De-dup against the DB (by hash or source id).
      const existing = await Document.findOne({
        $or: [{ fileHash }, { sourceName: source, sourceId: candidate.id }],
      }).select("_id");
      if (existing) {
        onProgress({ stage: "skipped", source, title, url, error: "already in library" });
        continue;
      }
      batchHashes.add(fileHash);

      // Persist to a temp file (honours the documented temp-dir contract).
      const filePath = path.join(tmpDir, `${uuidv4()}.${ext}`);
      await fs.writeFile(filePath, buffer);

      // Upload to S3 under the shared uploads/ prefix.
      const s3Key = `uploads/fetched/${source}/${uuidv4()}.${ext}`;
      try {
        await S3Manager.uploadObject(
          s3Key,
          buffer,
          CONTENT_TYPES[ext] || "application/octet-stream"
        );
      } catch (err) {
        logger.error(`[fetcher] S3 upload failed for ${url}: ${err.message}`);
        onProgress({ stage: "error", source, title, url, error: `upload: ${err.message}` });
        continue;
      }

      // Create the Document record (mirrors upload/presign), status=processing.
      let document;
      try {
        document = new Document({
          userId,
          originalFilename: safeFilename(title, ext),
          s3Path: s3Key,
          fileType: ext,
          sizeBytes: buffer.length,
          status: "processing",
          category,
          sourceUrl: candidate.url,
          sourceName: source,
          sourceId: candidate.id,
          license: candidate.license,
          fileHash,
        });
        await document.save();
      } catch (err) {
        // E11000 → another job ingested the same hash concurrently; treat as skip.
        logger.error(`[fetcher] Document save failed for ${url}: ${err.message}`);
        onProgress({ stage: "skipped", source, title, url, error: "duplicate (db)" });
        continue;
      }

      // Enqueue the existing processing worker (metadata, thumbnail, embeddings…).
      // Shares enqueueProcessing with uploads and manual retries so all three
      // get the same attempt count, backoff and job-id de-duplication.
      await enqueueProcessing(document._id, s3Key);

      logger.info("document fetched", {
        fetch_log: {
          source,
          title,
          url: candidate.url,
          license: candidate.license,
          fileHash,
          documentId: document._id.toString(),
        },
      });

      documents.push({
        filePath,
        originalUrl: candidate.url,
        source,
        sourceMetadata: {
          id: candidate.id,
          title: candidate.title,
          author: candidate.author,
          year: candidate.year,
          license: candidate.license,
        },
        fileHash,
        sizeMB: +(buffer.length / (1024 * 1024)).toFixed(2),
        ext,
        documentId: document._id.toString(),
      });

      onProgress({
        stage: "downloading",
        source,
        title,
        url,
        current: documents.length,
        total: count,
      });
    }

    onProgress({
      stage: "done",
      current: documents.length,
      total: count,
    });

    logger.info(
      `[fetcher] category="${category}" requested=${count} ingested=${documents.length} candidates=${candidates.length}`
    );

    return { documents, tmpDir };
  } finally {
    // Clean up the temp dir regardless of outcome.
    await fs.rm(tmpDir, { recursive: true, force: true }).catch((err) =>
      logger.warn(`[fetcher] temp cleanup failed for ${tmpDir}: ${err.message}`)
    );
  }
}

export default fetchDocuments;
