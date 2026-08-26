import crypto from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import path from "path";
import Document from "../models/Document.js";
import S3Manager from "./s3.js";
import logger from "./logger.js";
import { createRequire } from "module";
import { GoogleGenAI } from "@google/genai";
import { HfInference } from "@huggingface/inference";
import Groq from "groq-sdk";

const require = createRequire(import.meta.url);

let pdfParse;
try {
  const rawPdfParse = require("pdf-parse");
  // Handle different export formats
  pdfParse = rawPdfParse.default || rawPdfParse;
} catch (error) {
  logger.error("Failed to load pdf-parse:", error);
  pdfParse = null;
}

const { PDFDocument } = require("pdf-lib");
const Tesseract = require("tesseract.js");
import { pdfToImg } from "pdftoimg-js";
import {
  generateContentThumbnail,
  generateFallbackThumbnail,
  readPptxSlides,
  thumbnailContentType,
  thumbnailKeyFor,
} from "./thumbnails.js";
import { generateSlug } from "./slug.js";
import { normalizeCategory, clampText } from "./categories.js";
import { generateUniversalTitle } from "./titles.js";
import {
  getAiSettings,
  getActiveProviders,
  getEmbeddingModel,
} from "./aiSettings.js";
import {
  hashFile,
  claimStoredFile,
  releaseStoredFile,
  deleteObjectIfUnreferenced,
} from "./storage.js";

// Resolve the pdf.js font/cmap assets bundled with pdftoimg-js so that
// server-side rasterization (thumbnails + OCR) can load the 14 standard fonts.
// Without these, pdf.js cannot find FoxitSerif.pfb et al. and floods the logs
// with "fetchStandardFontData failed" / "getPathGenerator - ignoring character"
// warnings while rendering degraded fallback glyphs.
//
// pdfjs-dist is nested under pdftoimg-js and guarded by an "exports" map, so we
// resolve it via pdftoimg-js's own module scope and then walk up to the
// directory that actually contains standard_fonts/ (robust to layout changes).
function resolvePdfjsAssetDir() {
  const fsSync = require("fs");
  const candidates = [];
  try {
    const reqFromPdftoimg = createRequire(require.resolve("pdftoimg-js"));
    candidates.push(reqFromPdftoimg.resolve("pdfjs-dist"));
  } catch {
    /* fall through */
  }
  try {
    candidates.push(require.resolve("pdfjs-dist"));
  } catch {
    /* fall through */
  }

  for (const entry of candidates) {
    let dir = path.dirname(entry);
    for (let i = 0; i < 6; i++) {
      if (fsSync.existsSync(path.join(dir, "standard_fonts"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const PDFJS_ASSET_DIR = resolvePdfjsAssetDir();

const PDFJS_FONT_OPTS = PDFJS_ASSET_DIR
  ? {
      standardFontDataUrl:
        path.join(PDFJS_ASSET_DIR, "standard_fonts") + path.sep,
      cMapUrl: path.join(PDFJS_ASSET_DIR, "cmaps") + path.sep,
      cMapPacked: true,
    }
  : {};

if (!PDFJS_ASSET_DIR) {
  logger.warn(
    "Could not resolve pdfjs-dist asset directory; PDF thumbnails/OCR may emit font warnings"
  );
}

// pdf.js emits non-actionable render warnings ("Ran out of space in font
// private use area", "Empty FlateDecode stream", "TT: undefined function", …)
// directly via console.log("Warning: …"). They are per-PDF quirks we cannot fix
// and can number in the hundreds per file. pdftoimg-js does not forward pdf.js's
// `verbosity` option, and the warnings originate in the (separate) worker module
// instance, so the only reliable suppression point is the shared process console.
// We filter ONLY pdf.js's "Warning:" lines, and only for the duration of the
// pdfToImg() call, then log a single summary count.
//
// Reentrancy matters here: four Bull processors run in this process, so two jobs
// can be inside this function at once. Nesting the patch would make the inner
// call capture the already-patched console and restore *that* as the permanent
// one, leaving suppression on forever and leaking a closure per overlap. The
// depth counter makes every nested call a pass-through.
let pdfWarningSuppressDepth = 0;

async function runWithPdfWarningsSuppressed(label, fn) {
  if (pdfWarningSuppressDepth > 0) {
    pdfWarningSuppressDepth++;
    try {
      return await fn();
    } finally {
      pdfWarningSuppressDepth--;
    }
  }

  pdfWarningSuppressDepth++;
  const origLog = console.log;
  const origWarn = console.warn;
  let suppressed = 0;
  const isPdfWarning = (args) =>
    typeof args[0] === "string" && args[0].startsWith("Warning: ");
  console.log = (...args) => {
    if (isPdfWarning(args)) {
      suppressed++;
      return;
    }
    origLog(...args);
  };
  console.warn = (...args) => {
    if (isPdfWarning(args)) {
      suppressed++;
      return;
    }
    origWarn(...args);
  };
  try {
    return await fn();
  } finally {
    pdfWarningSuppressDepth--;
    console.log = origLog;
    console.warn = origWarn;
    if (suppressed > 0) {
      logger.info(
        `[pdf] suppressed ${suppressed} pdf.js render warning(s) during ${label}`
      );
    }
  }
}

// --- PDF rasterization / OCR memory tuning -------------------------------
// pdf.js + canvas + Tesseract are the heaviest memory users in the pipeline.
// On small instances (e.g. Render's 512 MB tier) the defaults below keep peak
// RSS bounded: OCR renders ONE page at a time, reuses a single Tesseract
// worker, and uses modest rasterization scales. All overridable via env.
const OCR_ENABLED = process.env.DISABLE_OCR !== "true";
const OCR_MAX_PAGES = parseInt(process.env.OCR_MAX_PAGES, 10) || 3;
const OCR_SCALE = parseFloat(process.env.OCR_SCALE) || 1.2;
const THUMBNAIL_SCALE = parseFloat(process.env.THUMBNAIL_SCALE) || 1.5;

const HUGGINGFACE_TOKEN = process.env.HUGGINGFACE_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Model names were hardcoded, so every provider broke silently as vendors
// retired models and the pipeline quietly degraded to local heuristics. They
// are configurable now, with defaults that are current as of August 2026:
//   gemini-2.0-flash      retired; the API error recommends gemini-3.6-flash
//   llama-3.1-8b-instant  deprecated by Groq on 2026-06-17
//   text-embedding-004    shut down 2026-01-14, superseded by gemini-embedding-2
// When one of these is retired again, set the env var rather than editing code.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
// GEMINI_EMBEDDING_MODEL is not declared here: it was an unused duplicate of the
// one in shared/utils/aiSettings.js:25, which is the copy that is actually read.
// Two defaults for the same env var is how they drift apart.
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const HUGGINGFACE_MODEL =
  process.env.HUGGINGFACE_MODEL || "mistralai/Mistral-7B-Instruct-v0.3";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

// Constrains Gemini's output so the response is JSON by construction rather
// than by asking nicely in the prompt and hoping.
const METADATA_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    category: { type: "string" },
  },
  required: ["title", "description", "tags", "category"],
};

const PROVIDER_CALLS = {
  gemini: generateWithGemini,
  groq: generateWithGroq,
  huggingface: generateWithHuggingFace,
  ollama: generateWithOllama,
};

const PROVIDER_LABELS = {
  gemini: "Google Gemini",
  groq: "Groq",
  huggingface: "Hugging Face",
  ollama: "Ollama",
};

const geminiAI = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;
const geminiEmbeddingAI = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY, httpOptions: { apiVersion: "v1" } })
  : null;
const huggingface = HUGGINGFACE_TOKEN
  ? new HfInference(HUGGINGFACE_TOKEN)
  : null;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

let mammoth, XLSX;

async function ensureDependencies() {
  if (!mammoth) {
    mammoth = (await import("mammoth")).default;
  }
  if (!XLSX) {
    XLSX = (await import("xlsx")).default;
  }
}

export async function processDocument(
  documentId,
  s3Key,
  onProgress = () => {},
  { isFinalAttempt = true } = {}
) {
  const document = await Document.findById(documentId);
  if (!document) throw new Error(`Document ${documentId} not found`);

  let filePath, thumbnailPath;

  if (!document.processingStartedAt) {
    document.processingStartedAt = new Date();
  }

  try {
    await ensureDependencies();

    // Perform actual virus scan
    onProgress({ step: "virus-scan", message: "Scanning for viruses..." });

    // The bytes in S3 are immutable, so a clean scan stays valid. Reprocessing
    // used to redo the full VirusTotal round trip - minutes per document - to
    // reach the same answer.
    const previousScan = document.virusScanResult;
    const virusScanResult =
      previousScan?.clean === true
        ? previousScan
        : await performVirusScan(s3Key);

    if (previousScan?.clean === true) {
      logger.info(`Reusing clean scan result for ${s3Key}`);
    }

    if (!virusScanResult.clean) {
      throw new Error(
        `Virus scan failed: ${
          virusScanResult.details || "Malicious content detected"
        }`
      );
    }

    onProgress({
      step: "extracting-content",
      message: "Extracting text and data...",
    });
    filePath = await downloadFromS3(s3Key);

    // Hash before doing any expensive work: OCR and AI metadata on a file we
    // already hold are pure waste.
    const fileHash = await hashFile(filePath);

    // A reprocess re-runs this whole block. Remembering whether this document
    // already holds a reference keeps it from incrementing the count a second
    // time, which would pin the object in S3 forever.
    const alreadyClaimed = document.fileHash === fileHash;
    document.fileHash = fileHash;

    const alreadyOwned = await Document.findOne({
      _id: { $ne: document._id },
      userId: document.userId,
      fileHash,
      status: { $nin: ["deleted", "duplicate"] },
    })
      .select("_id generatedTitle slug")
      .lean();

    if (alreadyOwned) {
      // This user already has these exact bytes. Keep a tombstone pointing at
      // the original instead of a second copy of everything.
      logger.info(
        `Document ${documentId} duplicates ${alreadyOwned._id} for the same user`
      );

      document.status = "duplicate";
      document.duplicateOf = alreadyOwned._id;
      document.processingError = undefined;
      document.generatedTitle =
        alreadyOwned.generatedTitle || document.originalFilename.slice(0, 255);
      await document.save();

      // Give up the storage. If this document already held a reference (a
      // reprocess), release it properly so the shared object survives for
      // whoever else points at it; if not, the upload is ours alone to remove.
      await releaseStoredFile({
        documentId: document._id,
        fileHash: alreadyClaimed ? fileHash : null,
        s3Path: s3Key,
        thumbnailS3Path: document.thumbnailS3Path,
      });

      onProgress({
        step: "completed",
        message: "Already uploaded",
        completed: true,
        duplicate: true,
      });

      return;
    }

    // Different owners may hold the same file; they share one S3 object.
    if (!alreadyClaimed) {
      const claim = await claimStoredFile({
        documentId: document._id,
        hash: fileHash,
        s3Path: s3Key,
        sizeBytes: document.sizeBytes,
      });

      if (claim.deduplicated) {
        document.s3Path = claim.s3Path;
        s3Key = claim.s3Path;
        // The temp file we already downloaded is byte-identical, so there is
        // no need to fetch the canonical object again.
      }
    }

    const content = await extractContent(filePath, document.fileType);

    if (!content || content.trim().length === 0) {
      throw new Error("No content extracted from document");
    }

    onProgress({ step: "extracting-content", message: "Counting pages..." });
    const pageCount = await getAccuratePageCount(
      filePath,
      document.fileType,
      content
    );

    onProgress({
      step: "generating-metadata",
      message: "Generating AI metadata...",
    });
    const metadata = await generateEnhancedMetadata(
      content,
      document.originalFilename,
      document.fileType
    );

    metadata.pageCount = pageCount;
    document.pageCount = pageCount;

    onProgress({
      step: "creating-thumbnail",
      message: "Generating thumbnail...",
    });
    thumbnailPath = await generateThumbnail(filePath, document.fileType, content);

    if (thumbnailPath) {
      const thumbnailKey = thumbnailKeyFor(s3Key, thumbnailPath);
      await uploadThumbnail(thumbnailPath, thumbnailKey);

      // A reprocess can move the thumbnail to a different extension; drop the
      // old object so it does not linger unreferenced in the bucket.
      const previousKey = document.thumbnailS3Path;
      document.thumbnailS3Path = thumbnailKey;
      if (previousKey && previousKey !== thumbnailKey) {
        // Documents sharing a source object derive the same thumbnail key, so
        // the old one is not necessarily ours alone to delete.
        await deleteObjectIfUnreferenced({
          documentId: document._id,
          key: previousKey,
          field: "thumbnailS3Path",
        });
      }
    }

    onProgress({
      step: "generating-metadata",
      message: "Creating embeddings...",
    });
    const embedding = await generateLocalEmbeddings(content, metadata);

    // The AI output is untrusted input as far as the schema is concerned. An
    // invented category or an over-long title used to fail validation at save
    // time and discard the entire run, extraction and OCR included.
    document.generatedTitle =
      clampText(metadata.title, 255) || document.originalFilename.slice(0, 255);
    document.generatedDescription = clampText(metadata.description, 500);
    document.tags = Array.isArray(metadata.tags)
      ? metadata.tags
          .filter((tag) => typeof tag === "string" && tag.trim())
          .map((tag) => tag.trim().slice(0, 50))
          .slice(0, 25)
      : [];
    document.category = normalizeCategory(metadata.category);
    document.pageCount = metadata.pageCount;
    // document.embeddingsId = embeddingsId; // Deprecated in favor of direct embedding
    if (embedding) {
      document.embedding = embedding;
    }
    document.metadata = metadata;
    // Generated once and never regenerated, so a later title edit or a
    // reprocess does not silently change a URL that is already indexed.
    if (!document.slug) {
      document.slug = generateSlug(document.generatedTitle, document.originalFilename);
    }
    document.status = "processed";
    document.processedAt = new Date();
    document.processingError = undefined;
    document.virusScanResult = virusScanResult;

    onProgress({ step: "finalizing", message: "Saving document..." });

    try {
      await document.save();
    } catch (error) {
      // The random slug suffix collided. Astronomically unlikely, but a
      // collision must not fail the whole pipeline.
      if (error.code === 11000 && error.keyPattern?.slug) {
        document.slug = generateSlug(document.generatedTitle, document.originalFilename);
        await document.save();
      } else if (error.code === 11000 && error.keyPattern?.fileHash) {
        // A stale unique index on fileHash is still enforced in the database.
        // Losing an entire processing run - extraction, OCR, AI metadata - over
        // a deduplication hint is a terrible trade, so drop the hint and keep
        // the document. Run `npm run migrate -- 005 indexes` to fix it properly.
        logger.error(
          `fileHash is still uniquely indexed in the database; saving ${documentId} without it. ` +
            `Run: npm run migrate -- 005 indexes`
        );
        document.fileHash = undefined;
        await document.save();
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error(`Processing failed for document ${documentId}:`, error);

    // Only give up once the queue has exhausted its retries. Marking the
    // document failed on the first attempt made the remaining Bull retries
    // invisible - the UI showed an error while attempts 2 and 3 were still
    // pending, and a later success left a stale error message behind.
    if (isFinalAttempt) {
      document.status = "failed";
      document.processingError = error.message;
    }

    await document.save();
    throw error;
  } finally {
    await cleanupTempFile(filePath);
    if (thumbnailPath) await cleanupTempFile(thumbnailPath);
  }
}

async function performVirusScan(s3Key) {
  try {
    logger.info(`Starting virus scan for: ${s3Key}`);

    const vtApiKey = process.env.VIRUSTOTAL_API_KEY;
    if (!vtApiKey) {
      logger.warn(
        "⚠️ VirusTotal API key not configured, using basic validation"
      );
      return await performBasicFileValidation(s3Key);
    }

    return await scanWithVirusTotal(s3Key, vtApiKey);
  } catch (error) {
    logger.error(`Virus scan failed for ${s3Key}:`, error);
    // Fallback to basic validation instead of throwing
    return await performBasicFileValidation(s3Key);
  }
}

/**
 * VirusTotal already knows most files. Asking by hash is one request that
 * answers immediately; uploading is a multi-megabyte POST followed by up to 15
 * polls with backoff, which is 2-4 minutes per document. Uploading first made
 * every reprocess pay full price for a file VT had already analysed.
 *
 * Returns null when VT has not seen this hash, so the caller falls through to
 * the upload path.
 */
async function lookupVirusTotalByHash(fileBuffer, apiKey) {
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  try {
    const response = await fetch(
      `https://www.virustotal.com/api/v3/files/${sha256}`,
      { headers: { "x-apikey": apiKey } }
    );

    if (response.status === 404) return null; // not seen before
    if (!response.ok) return null; // rate limited or down; upload path decides

    const body = await response.json();
    const stats = body?.data?.attributes?.last_analysis_stats;
    if (!stats) return null;

    const malicious = stats.malicious || 0;
    const suspicious = stats.suspicious || 0;

    logger.info(
      `✓ VirusTotal cache hit for ${sha256.slice(0, 12)}… (malicious: ${malicious}, suspicious: ${suspicious})`
    );

    return {
      clean: malicious === 0 && suspicious === 0,
      scanner: "virustotal-cached",
      scannedAt: new Date(),
      details:
        malicious > 0 || suspicious > 0
          ? `Flagged by ${malicious} engine(s) as malicious, ${suspicious} as suspicious`
          : `Clean (${stats.undetected || 0} engines, cached result)`,
      sha256,
    };
  } catch (error) {
    logger.warn(`VirusTotal hash lookup failed, will upload: ${error.message}`);
    return null;
  }
}

async function scanWithVirusTotal(s3Key, apiKey) {
  try {
    const fileBuffer = await S3Manager.getObjectBuffer(s3Key);
    const fileSize = fileBuffer.length;

    // Ask by hash before spending an upload and a polling loop.
    const cached = await lookupVirusTotalByHash(fileBuffer, apiKey);
    if (cached) return cached;

    // VirusTotal has a 32MB limit for direct uploads
    if (fileSize > 32 * 1024 * 1024) {
      logger.warn(
        `File too large for VirusTotal (${fileSize} bytes), using basic validation`
      );
      return await performBasicFileValidation(s3Key);
    }

    const FormData = (await import("form-data")).default;
    const form = new FormData();
    const filename = s3Key.split("/").pop();
    form.append("file", fileBuffer, {
      filename: filename,
      contentType: "application/octet-stream",
    });

    // Upload file to VirusTotal
    logger.info("📤 Uploading file to VirusTotal...");

    // Use node https + form pipe
    const uploadResponse = await new Promise((resolve, reject) => {
      const options = {
        method: "POST",
        headers: {
          "x-apikey": apiKey,
          ...form.getHeaders(),
        },
      };

      const https = require("https");
      const req = https.request(
        "https://www.virustotal.com/api/v3/files",
        options,
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              text: () => Promise.resolve(data),
              json: () => Promise.resolve(JSON.parse(data)),
            });
          });
        }
      );

      req.on("error", reject);
      form.pipe(req);
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      logger.error(
        `VirusTotal upload failed: ${uploadResponse.status} - ${errorText}`
      );
      throw new Error(
        `VirusTotal upload failed: ${uploadResponse.status} - ${errorText}`
      );
    }

    const uploadData = await uploadResponse.json();
    const analysisId = uploadData.data.id;

    logger.info(`✓ File uploaded. Analysis ID: ${analysisId}`);

    // Poll for analysis results with exponential backoff
    let attempts = 0;
    const maxAttempts = 15;
    let waitTime = 2000; // Start with 2 seconds

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      logger.info(
        `🔍 Checking analysis status (attempt ${
          attempts + 1
        }/${maxAttempts})...`
      );

      const analysisResponse = await fetch(
        `https://www.virustotal.com/api/v3/analyses/${analysisId}`,
        {
          headers: { "x-apikey": apiKey },
        }
      );

      if (!analysisResponse.ok) {
        throw new Error(`Failed to fetch analysis: ${analysisResponse.status}`);
      }

      const analysisData = await analysisResponse.json();
      const status = analysisData.data.attributes.status;

      if (status === "completed") {
        const stats = analysisData.data.attributes.stats;
        const malicious = stats.malicious || 0;
        const suspicious = stats.suspicious || 0;
        const undetected = stats.undetected || 0;
        const harmless = stats.harmless || 0;

        logger.info(
          `📊 Scan results: Malicious: ${malicious}, Suspicious: ${suspicious}, Harmless: ${harmless}, Undetected: ${undetected}`
        );

        // Strict detection: Any malicious or more than 2 suspicious flags
        if (malicious > 0 || suspicious > 2) {
          logger.error(`🚨 THREAT DETECTED in ${s3Key}`);
          return {
            clean: false,
            scanner: "virustotal",
            scannedAt: new Date(),
            details: `Detected by ${malicious} engines as malicious (${suspicious} flagged as suspicious)`,
            threat:
              malicious > 0
                ? "Malware detected"
                : "Suspicious content detected",
            vtResults: stats,
            analysisId: analysisId,
          };
        }

        logger.info(`✅ VirusTotal scan completed: ${s3Key} is CLEAN`);
        return {
          clean: true,
          scanner: "virustotal",
          scannedAt: new Date(),
          details: `Scanned by ${harmless + undetected} engines - Clean`,
          vtResults: stats,
          analysisId: analysisId,
        };
      }

      // Exponential backoff: increase wait time
      waitTime = Math.min(waitTime * 1.5, 10000); // Max 10 seconds
      attempts++;
    }

    // Timeout reached - be cautious
    logger.warn("⏱️ VirusTotal scan timeout - flagging for manual review");
    return {
      clean: false,
      scanner: "virustotal",
      scannedAt: new Date(),
      details: "Scan timeout - requires manual review",
      threat: "Unable to complete scan",
      warning: "MANUAL_REVIEW_REQUIRED",
    };
  } catch (error) {
    logger.error("❌ VirusTotal scan error:", {
      message: error.message,
      stack: error.stack,
      s3Key: s3Key,
    });
    // Fallback to basic validation
    return await performBasicFileValidation(s3Key);
  }
}

async function performBasicFileValidation(s3Key) {
  const fileBuffer = await S3Manager.getObjectBuffer(s3Key);
  const fileExtension = s3Key.split(".").pop().toLowerCase();

  // 1. Block dangerous extensions
  const dangerousExtensions = [
    "exe",
    "bat",
    "cmd",
    "scr",
    "pif",
    "com",
    "vbs",
    "js",
    "jar",
    "wsf",
    "msi",
    "app",
    "deb",
    "rpm",
    "dmg",
    "pkg",
    "run",
    "bin",
  ];

  if (dangerousExtensions.includes(fileExtension)) {
    return {
      clean: false,
      scanner: "basic-validation",
      scannedAt: new Date(),
      details: `Blocked executable file type: .${fileExtension}`,
      threat: "Executable file type blocked",
    };
  }

  // 2. Validate file size
  if (fileBuffer.length === 0) {
    return {
      clean: false,
      scanner: "basic-validation",
      scannedAt: new Date(),
      details: "Empty file detected",
      threat: "Invalid file",
    };
  }

  if (fileBuffer.length > 100 * 1024 * 1024) {
    return {
      clean: false,
      scanner: "basic-validation",
      scannedAt: new Date(),
      details: "File exceeds 100MB limit",
      threat: "File too large",
    };
  }

  // 3. Check file signature (magic numbers)
  const isValidFileType = validateFileSignature(fileBuffer, fileExtension);
  if (!isValidFileType) {
    return {
      clean: false,
      scanner: "basic-validation",
      scannedAt: new Date(),
      details: "File signature doesn't match extension",
      threat: "Potential file spoofing",
    };
  }

  // 4. Scan for suspicious patterns
  const suspiciousPatterns = [
    Buffer.from("eval("),
    Buffer.from("<script"),
    Buffer.from("<?php"),
    Buffer.from("#!/bin/"),
  ];

  for (const pattern of suspiciousPatterns) {
    if (fileBuffer.includes(pattern)) {
      logger.warn(`Suspicious pattern found in ${s3Key}`);
      return {
        clean: false,
        scanner: "basic-validation",
        scannedAt: new Date(),
        details: "Suspicious code pattern detected",
        threat: "Potentially malicious content",
      };
    }
  }

  return {
    clean: true,
    scanner: "basic-validation",
    scannedAt: new Date(),
    details: "Basic validation passed",
  };
}

function validateFileSignature(buffer, extension) {
  const signatures = {
    pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
    docx: [0x50, 0x4b, 0x03, 0x04], // ZIP-based
    xlsx: [0x50, 0x4b, 0x03, 0x04],
    pptx: [0x50, 0x4b, 0x03, 0x04],
  };

  const expectedSignature = signatures[extension];
  if (!expectedSignature) return true; // Unknown type, allow

  for (let i = 0; i < expectedSignature.length; i++) {
    if (buffer[i] !== expectedSignature[i]) return false;
  }

  return true;
}

/**
 * Asks each configured metadata provider to answer one trivial prompt.
 *
 * The pipeline degrades silently: when every provider is down it falls through
 * to local heuristics and still produces a "successful" document, just with a
 * title scraped off the first page. That is fine for one upload and very much
 * not fine for a bulk backfill, so callers that generate many titles at once
 * check this first.
 */
export async function checkMetadataProviders({ onlyEnabled = true } = {}) {
  const probe =
    "Quarterly engineering review covering pipeline throughput and latency.";

  const configured = {
    gemini: Boolean(geminiAI),
    groq: Boolean(groq),
    huggingface: Boolean(huggingface),
    ollama: true, // reachability is the only way to know
  };

  const settings = await getAiSettings();
  const providers = onlyEnabled
    ? settings.providers.filter((entry) => entry.enabled)
    : settings.providers;

  const results = [];

  for (const { provider, model, enabled } of providers) {
    if (!configured[provider]) {
      results.push({
        provider,
        model,
        enabled,
        ok: false,
        reason: "API key not configured",
      });
      continue;
    }

    const startedAt = Date.now();
    try {
      const result = await PROVIDER_CALLS[provider](probe, "probe.txt", model);
      results.push({
        provider,
        model,
        enabled,
        ok: Boolean(result?.title),
        latencyMs: Date.now() - startedAt,
        reason: result?.title ? undefined : "responded without a title",
      });
    } catch (error) {
      results.push({
        provider,
        model,
        enabled,
        ok: false,
        latencyMs: Date.now() - startedAt,
        reason: error.message,
      });
    }
  }

  return { results, anyWorking: results.some((result) => result.ok) };
}

/** Probes a single provider/model pair without saving anything. */
export async function testMetadataProvider(provider, model) {
  const call = PROVIDER_CALLS[provider];
  if (!call) throw new Error(`Unknown provider: ${provider}`);

  const startedAt = Date.now();

  try {
    const result = await call(
      "Quarterly engineering review covering pipeline throughput and latency.",
      "probe.txt",
      model
    );

    return {
      ok: Boolean(result?.title),
      latencyMs: Date.now() - startedAt,
      sample: result?.title
        ? { title: result.title, category: result.category }
        : undefined,
      reason: result?.title ? undefined : "responded without a title",
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      reason: error.message,
    };
  }
}

/** Probes the embedding model, which fails silently in normal processing. */
export async function testEmbeddingModel(model) {
  if (!geminiEmbeddingAI) {
    return { ok: false, reason: "GEMINI_API_KEY is not configured" };
  }

  const startedAt = Date.now();

  try {
    const result = await geminiEmbeddingAI.models.embedContent({
      model: model || (await getEmbeddingModel()),
      contents: "probe",
    });

    const dimensions = result.embeddings?.[0]?.values?.length || 0;

    return {
      ok: dimensions > 0,
      latencyMs: Date.now() - startedAt,
      dimensions,
      reason: dimensions > 0 ? undefined : "returned an empty embedding",
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      reason: error.message,
    };
  }
}

/**
 * Rebuilds only the thumbnail for an existing document.
 *
 * Deliberately separate from processDocument: a full reprocess would re-run the
 * AI metadata step and overwrite titles, descriptions and categories that an
 * admin may have edited by hand. This touches thumbnailS3Path and nothing else.
 */
export async function regenerateThumbnail(documentId) {
  const document = await Document.findById(documentId);
  if (!document) throw new Error(`Document ${documentId} not found`);
  if (!document.s3Path) throw new Error(`Document ${documentId} has no file`);

  await ensureDependencies();

  let filePath, thumbnailPath;

  try {
    filePath = await downloadFromS3(document.s3Path);

    // Only the text-page renderers need extracted content; pptx and xlsx read
    // the file directly, and pdf is rasterized. Skipping extraction here keeps
    // a backfill from re-running OCR over every scanned PDF.
    let content;
    if (document.fileType === "docx" || document.fileType === "csv") {
      content = await extractContent(filePath, document.fileType);
    }

    thumbnailPath = await generateThumbnail(
      filePath,
      document.fileType,
      content
    );

    if (!thumbnailPath) {
      throw new Error("Thumbnail generation produced no file");
    }

    const thumbnailKey = thumbnailKeyFor(document.s3Path, thumbnailPath);
    await uploadThumbnail(thumbnailPath, thumbnailKey);

    const previousKey = document.thumbnailS3Path;
    document.thumbnailS3Path = thumbnailKey;
    await document.save();

    if (previousKey && previousKey !== thumbnailKey) {
      await deleteObjectIfUnreferenced({
        documentId: document._id,
        key: previousKey,
        field: "thumbnailS3Path",
      });
    }

    return thumbnailKey;
  } finally {
    await cleanupTempFile(filePath);
    if (thumbnailPath) await cleanupTempFile(thumbnailPath);
  }
}

async function generateThumbnail(filePath, fileType, content) {
  try {
    logger.info(
      `🎨 Generating first page thumbnail for ${fileType}: ${filePath}`
    );

    const fs = await import("fs");

    // Verify file exists
    try {
      await fs.promises.access(filePath);
    } catch (accessError) {
      logger.error(`❌ File not accessible: ${filePath}`, accessError);
      return await generateFallbackThumbnail(fileType);
    }

    // PDFs are rasterized for real; every other type gets a page rendered from
    // its own extracted content (see shared/utils/thumbnails.js).
    if (fileType === "pdf") {
      return await generatePDFFirstPageThumbnail(filePath);
    }

    return await generateContentThumbnail(filePath, fileType, content);
  } catch (error) {
    logger.error(`❌ Thumbnail generation failed for ${filePath}:`, {
      error: error.message,
      stack: error.stack,
      fileType: fileType,
    });
    return await generateFallbackThumbnail(fileType);
  }
}

async function generatePDFFirstPageThumbnail(filePath) {
  const fs = await import("fs");
  let outPath;

  try {
    logger.info("Generating first-page PDF thumbnail (pdftoimg-js)...", {
      filePath,
    });

    const result = await runWithPdfWarningsSuppressed("thumbnail", () =>
      pdfToImg(filePath, {
        pages: "firstPage",
        imgType: "jpg",
        scale: THUMBNAIL_SCALE,
        background: "white",
        ...PDFJS_FONT_OPTS,
      })
    );

    const imgSrc = Array.isArray(result) ? result[0] : result;
    if (!imgSrc) {
      throw new Error("pdftoimg-js returned no image for first page");
    }

    const base64 = imgSrc.includes(",") ? imgSrc.split(",")[1] : imgSrc;
    const buffer = Buffer.from(base64, "base64");

    outPath = path.join(
      tmpdir(),
      `pdf-thumb-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
    );

    await fs.promises.writeFile(outPath, buffer);

    logger.info("PDF thumbnail generated", {
      filePath,
      thumbnailPath: outPath,
    });

    return outPath;
  } catch (err) {
    logger.error("PDF thumbnail generation failed", {
      filePath,
      error: err.message,
      stack: err.stack,
    });

    // Callers only ever clean up the path this function *returns*, and the
    // fallback below returns a different one - so a partial write here would
    // never be collected.
    if (outPath) {
      await fs.promises.unlink(outPath).catch(() => {});
    }

    // Fallback: generic thumbnail
    return await generateFallbackThumbnail("pdf");
  }
}

async function uploadThumbnail(thumbnailPath, thumbnailKey) {
  try {
    const fs = await import("fs");
    const fileBuffer = await fs.promises.readFile(thumbnailPath);
    await S3Manager.uploadObject(
      thumbnailKey,
      fileBuffer,
      thumbnailContentType(thumbnailPath)
    );
    logger.info(`✅ Thumbnail uploaded to: ${thumbnailKey}`);
  } catch (error) {
    logger.error("Error uploading thumbnail:", error);
    throw error;
  }
}

async function downloadFromS3(s3Key) {
  const tmpPath = join(
    tmpdir(),
    `docsdb-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );
  const fs = await import("fs");
  let objectData;
  try {
    objectData = await S3Manager.getObject(s3Key);
    if (objectData.Body) {
      const chunks = [];
      for await (const chunk of objectData.Body) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      await fs.promises.writeFile(tmpPath, buffer);
    } else throw new Error("No body in S3 response");
    return tmpPath;
  } catch (error) {
    // On failure this function never returns tmpPath, so processDocument's
    // finally block has nothing to clean up - the partial file would stay in
    // os.tmpdir() forever, once per retry. Same for the unread response body,
    // which holds a socket until GC.
    objectData?.Body?.destroy?.();
    await fs.promises.unlink(tmpPath).catch(() => {});
    logger.error("Error downloading from S3:", error);
    throw error;
  }
}

async function extractContent(filePath, fileType) {
  await ensureDependencies();
  switch (fileType) {
    case "pdf":
      return await extractFromPDF(filePath);
    case "docx":
      return await extractFromDOCX(filePath);
    case "pptx":
      return await extractFromPPTX(filePath);
    case "xlsx":
      return await extractFromXLSX(filePath);
    case "csv":
      return await extractFromCSV(filePath);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function extractFromPDF(filePath) {
  const start = Date.now();
  logger.info("Starting PDF extraction...", { filePath });

  const fs = await import("fs");

  try {
    if (!pdfParse || typeof pdfParse !== "function") {
      if (!OCR_ENABLED) {
        throw new Error("pdf-parse unavailable and OCR is disabled");
      }
      logger.warn("pdf-parse not available, falling back to OCR");
      const ocrText = await extractPDFWithOCR(filePath);

      if (!ocrText || !ocrText.trim()) {
        throw new Error("No OCR text extracted from PDF images");
      }

      logger.info("PDF extraction succeeded via OCR", {
        filePath,
        length: ocrText.length,
        durationMs: Date.now() - start,
      });

      return ocrText.trim();
    }

    const buffer = await fs.promises.readFile(filePath);

    // 1) Try native text extraction (fast path)
    let data;
    try {
      data = await pdfParse(buffer);
    } catch (err) {
      logger.error("PDF extraction failed (pdf-parse)", {
        error: err.message,
        stack: err.stack,
      });
      data = null;
    }

    let text = (data && data.text ? data.text : "").trim();

    logger.info("PDF text length (pdf-parse)", {
      filePath,
      length: text.length,
    });

    // If we got enough text, use it
    if (text.length >= 50) {
      logger.info("PDF extraction succeeded via pdf-parse", {
        filePath,
        durationMs: Date.now() - start,
      });
      return text;
    }

    // 2) Fallback to OCR if pdf-parse yields too little
    if (!OCR_ENABLED) {
      logger.warn(
        "pdf-parse yielded little text and OCR is disabled; using what we have",
        { filePath, length: text.length }
      );
      return text;
    }

    logger.warn(
      "PDF text too short or empty from pdf-parse; falling back to OCR...",
      { filePath, length: text.length }
    );

    const ocrText = await extractPDFWithOCR(filePath);

    if (!ocrText || !ocrText.trim()) {
      throw new Error("No OCR text extracted from PDF images");
    }

    logger.info("PDF extraction succeeded via OCR fallback", {
      filePath,
      length: ocrText.length,
      durationMs: Date.now() - start,
    });

    return ocrText.trim();
  } catch (err) {
    logger.error("PDF extraction failed", {
      filePath,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }
}

async function extractPDFWithOCR(filePath, maxPages = OCR_MAX_PAGES) {
  const start = Date.now();
  logger.info("Starting OCR extraction for PDF...", {
    filePath,
    maxPages,
    scale: OCR_SCALE,
  });

  // Single reusable Tesseract worker — created once and terminated in finally.
  // The old code called Tesseract.recognize() per page, which reloaded the
  // ~15 MB English model every time and risked leaking workers. Rendering and
  // OCR'ing one page at a time keeps peak memory to a single page image, which
  // is what lets this run within a 512 MB instance.
  let worker;
  try {
    const fs = await import("fs");
    const pdfBytes = await fs.promises.readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();

    const pagesToProcess = Math.min(totalPages, maxPages);
    if (pagesToProcess === 0) {
      throw new Error("PDF has zero pages");
    }
    logger.info("OCR target pages", { pagesToProcess });

    worker = await Tesseract.createWorker("eng");

    let combinedText = "";

    for (let page = 1; page <= pagesToProcess; page++) {
      // Render just THIS page so only one page image is in memory at a time.
      const rendered = await runWithPdfWarningsSuppressed("ocr", () =>
        pdfToImg(filePath, {
          pages: [page],
          imgType: "png",
          scale: OCR_SCALE,
          background: "white",
          ...PDFJS_FONT_OPTS,
        })
      );

      const src = Array.isArray(rendered) ? rendered[0] : rendered;
      if (!src) continue;

      const base64 = src.includes(",") ? src.split(",")[1] : src;
      let buffer = Buffer.from(base64, "base64");

      const result = await worker.recognize(buffer);
      const pageText = (result.data && result.data.text) || "";
      logger.info("OCR page result", { page, length: pageText.length });

      combinedText += pageText + "\n";
      buffer = null; // release the page image before the next iteration
    }

    combinedText = combinedText.trim();
    if (!combinedText) {
      throw new Error("No OCR text extracted from PDF images");
    }

    logger.info("OCR extraction successful", {
      filePath,
      totalLength: combinedText.length,
      durationMs: Date.now() - start,
    });

    return combinedText;
  } catch (err) {
    logger.error("OCR extraction failed", {
      filePath,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        logger.warn(`Failed to terminate Tesseract worker: ${e.message}`);
      }
    }
  }
}

/**
 * OCRs a range of pages, reporting each one as it is read.
 *
 * extractPDFWithOCR above concatenates the first few pages into one string,
 * which is what metadata generation wants. Ask AI wants the opposite: each page
 * separately so a citation can say "Page 41", the ability to start where a
 * previous run stopped, and the ability to stop on a deadline - OCR is measured
 * in seconds per page, so no single run may hold the worker for an hour.
 *
 * One Tesseract worker for the whole range, and one page image in memory at a
 * time: reloading the ~15 MB language model per page was the original memory
 * problem, and rendering the whole document at once was the other.
 *
 * @param {Function} onPage awaited for every page, including one that rendered
 *   nothing - the caller tracks progress by page number, so a page that reports
 *   nothing would otherwise be retried forever.
 * @param {Function} shouldStop checked before each page.
 */
export async function ocrPdfPages(
  filePath,
  { startPage = 1, maxPages = 1, scale = OCR_SCALE, onPage, shouldStop } = {}
) {
  if (!OCR_ENABLED) throw new Error("OCR is disabled");

  const fs = await import("fs");
  const pdfBytes = await fs.promises.readFile(filePath);
  const totalPages = (await PDFDocument.load(pdfBytes)).getPageCount();
  const lastPage = Math.min(totalPages, startPage + maxPages - 1);

  if (startPage > lastPage) {
    return { pagesRead: 0, totalPages, stopped: false };
  }

  let worker;
  let pagesRead = 0;

  try {
    worker = await Tesseract.createWorker("eng");

    for (let page = startPage; page <= lastPage; page++) {
      if (shouldStop?.()) {
        return { pagesRead, totalPages, stopped: true };
      }

      const rendered = await runWithPdfWarningsSuppressed("ask-ocr", () =>
        pdfToImg(filePath, {
          pages: [page],
          imgType: "png",
          scale,
          background: "white",
          ...PDFJS_FONT_OPTS,
        })
      );

      const src = Array.isArray(rendered) ? rendered[0] : rendered;
      let text = "";

      if (src) {
        const base64 = src.includes(",") ? src.split(",")[1] : src;
        let buffer = Buffer.from(base64, "base64");
        const result = await worker.recognize(buffer);
        buffer = null; // release the page image before the next iteration
        text = (result.data?.text || "").trim();
      }

      pagesRead++;
      await onPage?.({ page, text, totalPages });
    }

    return { pagesRead, totalPages, stopped: false };
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (error) {
        logger.warn(`Failed to terminate Tesseract worker: ${error.message}`);
      }
    }
  }
}

async function extractFromDOCX(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || "";
  } catch (error) {
    logger.error("DOCX extraction failed:", error);
    throw new Error(`DOCX extraction failed: ${error.message}`);
  }
}

async function extractFromPPTX(filePath) {
  try {
    // This used to return a fixed placeholder string, which meant every
    // presentation got AI metadata generated from the same sentence.
    const slides = await readPptxSlides(filePath, 200);

    const content = slides
      .map((texts, index) =>
        texts.length ? `Slide ${index + 1}\n${texts.join("\n")}` : ""
      )
      .filter(Boolean)
      .join("\n\n");

    if (!content.trim()) {
      throw new Error("Presentation contains no extractable text");
    }

    return content;
  } catch (error) {
    logger.error("PPTX extraction failed:", error);
    throw new Error(`PPTX extraction failed: ${error.message}`);
  }
}

async function extractFromXLSX(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    let content = "";
    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      content += `Sheet: ${sheetName}\n`;
      content += XLSX.utils.sheet_to_csv(worksheet) + "\n\n";
    });
    return content;
  } catch (error) {
    logger.error("XLSX extraction failed:", error);
    throw new Error(`XLSX extraction failed: ${error.message}`);
  }
}

async function extractFromCSV(filePath) {
  const fs = await import("fs");
  return fs.promises.readFile(filePath, "utf8");
}


/**
 * Walks the configured provider chain and returns the first usable answer.
 *
 * Which providers run, in what order, and with which model all come from the
 * admin settings rather than being hardcoded here.
 */
async function generateEnhancedMetadata(content, filename, fileType) {
  const providers = await getActiveProviders();

  for (const { provider, model } of providers) {
    const call = PROVIDER_CALLS[provider];
    if (!call) continue;

    try {
      const result = await call(content, filename, model);
      if (result?.title) {
        logger.info(`Used ${PROVIDER_LABELS[provider]} (${model}) for metadata`);
        return enrichMetadataWithLocalData(result, content, fileType, provider);
      }
    } catch (error) {
      logger.warn(`${PROVIDER_LABELS[provider]} failed: ${error.message}`);
    }
  }

  logger.info("Using smart local processing for metadata");
  return generateUniversalMetadata(content, filename, fileType);
}

async function generateWithGemini(content, filename, model = GEMINI_MODEL) {
  if (!geminiAI) throw new Error("Gemini API key not configured");

  const truncatedContent = content.substring(0, 4000);
  const prompt = `Analyze this document and return ONLY valid JSON:
{
  "title": "concise title under 80 chars",
  "description": "1-2 sentence description", 
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "category": "only choose ONE strictly from this list — do not invent new ones:
  ["for-you","technology","business","education","health","entertainment","sports",
  "finance-money-management","games-activities","comics","philosophy","career-growth",
  "politics","biography-memoir","study-aids-test-prep","law","art","science","history",
  "erotica","lifestyle","religion-spirituality","self-improvement","language-arts",
  "cooking-food-wine","true-crime","sheet-music","fiction","non-fiction",
  "science-fiction","fantasy","romance","thriller-suspense","horror","poetry",
  "graphic-novels","young-adult","children","parenting-family","marketing-sales",
  "psychology","social-sciences","engineering","mathematics","data-science",
  "nature-environment","travel","reference","design","news-media",
  "professional-development","other"]
}

Document: ${filename}
Content: ${truncatedContent}

Return only valid JSON and do not generate new categories like 'computer-science'.`;

  try {
    const response = await geminiAI.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.3,
        // Gemini 3 models think before answering and wrap prose around JSON,
        // which is why every call failed with "No JSON found in response".
        // Constraining the response to a schema removes the parsing guesswork,
        // and the larger budget leaves room for the thinking tokens that were
        // exhausting the old 300-token cap before any JSON was produced.
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: METADATA_RESPONSE_SCHEMA,
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response text from Gemini");

    return parseAIResponse(text);
  } catch (error) {
    throw new Error(`Gemini: ${error.message}`);
  }
}

async function generateWithGroq(content, filename, model = GROQ_MODEL) {
  if (!groq) throw new Error("Groq API key not configured");

  const truncatedContent = content.substring(0, 4000);

  try {
    const response = await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a document analysis assistant. Return ONLY valid JSON without any formatting or markdown.",
        },
        {
          role: "user",
          content: `Analyze this document and return JSON with title, description, tags, category: "any one from these" - ["technology","business","education","health","entertainment","sports","finance-money-management","games-activities","comics","philosophy","career-growth","politics","biography-memoir","study-aids-test-prep","law","art","science","history","erotica","lifestyle","religion-spirituality","self-improvement","language-arts","cooking-food-wine","true-crime","sheet-music","fiction","non-fiction","science-fiction","fantasy","romance","thriller-suspense","horror","poetry","graphic-novels","young-adult","children","parenting-family","marketing-sales","psychology","social-sciences","engineering","mathematics","nature-environment","travel","reference","design", "news-media", "professional-development", "other"]
Filename: ${filename}
Content: ${truncatedContent}`,
        },
      ],
      temperature: 0.3,
      // The recorded failure was literally "max completion tokens reached
      // before generating a valid document": gpt-oss models spend tokens
      // reasoning before emitting JSON, and 300 was not enough to finish.
      max_tokens: 2048,
      response_format: { type: "json_object" },
      // Reasoning is wasted effort for a summarisation task and is what was
      // eating the budget. Only gpt-oss models accept this parameter.
      ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
    });

    const contentText = response.choices[0]?.message?.content;
    if (!contentText) throw new Error("No response content from Groq");

    return parseAIResponse(contentText);
  } catch (error) {
    throw new Error(`Groq: ${error.message}`);
  }
}

async function generateWithHuggingFace(content, filename, model = HUGGINGFACE_MODEL) {
  if (!huggingface) throw new Error("Hugging Face token not configured");

  const truncatedContent = content.substring(0, 2000);
  const prompt = `Analyze document and return JSON: { "title": "...", "description": "...", "tags": [...], "category": "any one from these" - ["technology","business","education","health","entertainment","sports","finance-money-management","games-activities","comics","philosophy","career-growth","politics","biography-memoir","study-aids-test-prep","law","art","science","history","erotica","lifestyle","religion-spirituality","self-improvement","language-arts","cooking-food-wine","true-crime","sheet-music","fiction","non-fiction","science-fiction","fantasy","romance","thriller-suspense","horror","poetry","graphic-novels","young-adult","children","parenting-family","marketing-sales","psychology","social-sciences","engineering","mathematics","nature-environment","travel","reference","design", "news-media", "professional-development", "other"] }
Document: ${filename}
Content: ${truncatedContent}`;

  try {
    // Inference providers serve these models under the "conversational" task,
    // not "text-generation" - textGeneration() fails with a task-mismatch error
    // regardless of which model is named.
    const result = await huggingface.chatCompletion({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a document analysis assistant. Return ONLY valid JSON without any formatting or markdown.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const text = result.choices?.[0]?.message?.content;
    if (!text) throw new Error("No response content from Hugging Face");

    return parseAIResponse(text);
  } catch (error) {
    throw new Error(`Hugging Face: ${error.message}`);
  }
}

async function generateWithOllama(content, filename, model = OLLAMA_MODEL) {
  const truncatedContent = content.substring(0, 2000);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: `Return JSON: { "title": "...", "description": "...", "tags": ["tag1","tag2","tag3"], "category": "any one from these" - ["technology","business","education","health","entertainment","sports","finance-money-management","games-activities","comics","philosophy","career-growth","politics","biography-memoir","study-aids-test-prep","law","art","science","history","erotica","lifestyle","religion-spirituality","self-improvement","language-arts","cooking-food-wine","true-crime","sheet-music","fiction","non-fiction","science-fiction","fantasy","romance","thriller-suspense","horror","poetry","graphic-novels","young-adult","children","parenting-family","marketing-sales","psychology","social-sciences","engineering","mathematics","nature-environment","travel","reference","design", "news-media", "professional-development", "other"] }
Document: ${filename}
Content: ${truncatedContent}`,
        stream: false,
        format: "json",
        options: { temperature: 0.3 },
      }),
    });

    if (!response.ok) throw new Error("Ollama not running");
    const result = await response.json();

    return parseAIResponse(result.response);
  } catch (error) {
    throw new Error(`Ollama: ${error.message}`);
  }
}

function parseAIResponse(text) {
  if (!text) throw new Error("Empty response");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.title || !parsed.description) {
      throw new Error("Missing required fields in JSON");
    }
    return parsed;
  } catch (parseError) {
    throw new Error(`Invalid JSON: ${parseError.message}`);
  }
}

function enrichMetadataWithLocalData(
  aiMetadata,
  content,
  fileType,
  generatedBy
) {
  return {
    ...aiMetadata,
    pageCount: estimatePageCount(content),
    wordCount: content.split(/\s+/).length,
    characterCount: content.length,
    language: detectLanguage(content),
    keyThemes: extractUniversalThemes(content),
    summary: generateUniversalSummary(content, fileType),
    documentType: fileType,
    readabilityScore: calculateReadability(content),
    generatedBy,
    processedAt: new Date().toISOString(),
  };
}

function generateUniversalMetadata(content, filename, fileType) {
  const title = generateUniversalTitle(content, filename, fileType);
  const description = generateUniversalDescription(content, fileType);
  const tags = extractUniversalTags(content, title, fileType);
  const category = detectUniversalCategory(content, fileType);

  return {
    title,
    description,
    tags,
    category,
    pageCount: estimatePageCount(content),
    wordCount: content.split(/\s+/).length,
    characterCount: content.length,
    language: detectLanguage(content),
    keyThemes: extractUniversalThemes(content),
    summary: generateUniversalSummary(content, fileType),
    documentType: fileType,
    readabilityScore: calculateReadability(content),
    generatedBy: "smart-local-processor",
    processedAt: new Date().toISOString(),
  };
}


function generateUniversalDescription(content, _fileType) {
  const paragraphs = content
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 50);
  if (paragraphs.length > 0) {
    const bestParagraph = paragraphs.reduce(
      (best, current) => {
        const words = current.toLowerCase().split(/\s+/);
        const uniqueWords = new Set(words);
        const diversity = uniqueWords.size / words.length;
        const lengthScore = 1 - Math.abs(0.7 - words.length / 200);
        return diversity * lengthScore > best.score
          ? { text: current, score: diversity * lengthScore }
          : best;
      },
      { text: paragraphs[0], score: 0 }
    );
    return bestParagraph.text.substring(0, 250).trim() + "...";
  }

  if (content.length < 500)
    return content.substring(0, 200) + (content.length > 200 ? "..." : "");

  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  const keySentences = sentences
    .slice(0, 3)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return keySentences.join(". ") + ".";
}

function extractUniversalTags(content, title, _fileType) {
  const allText = (content + " " + title).toLowerCase();
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "as",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "this",
    "that",
    "these",
    "those",
    "them",
    "then",
    "than",
    "from",
    "into",
    "using",
    "based",
    "within",
    "between",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "upon",
    "about",
    "against",
    "among",
    "since",
    "until",
  ]);

  const words = allText
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word.toLowerCase()));
  const wordScores = {};
  words.forEach((word) => {
    const cleanWord = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleanWord.length > 3)
      wordScores[cleanWord] = (wordScores[cleanWord] || 0) + 1;
  });

  const titleWords = new Set(title.toLowerCase().split(/\s+/));
  Object.keys(wordScores).forEach((word) => {
    if (titleWords.has(word)) wordScores[word] *= 3;
  });

  const phrases = {};
  const sentences = content.toLowerCase().split(/[.!?]+/);
  sentences.forEach((sentence) => {
    const sentenceWords = sentence
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    for (let i = 0; i < sentenceWords.length - 1; i++) {
      const phrase2 = `${sentenceWords[i]} ${sentenceWords[i + 1]}`;
      if (
        !stopWords.has(sentenceWords[i]) &&
        !stopWords.has(sentenceWords[i + 1])
      )
        phrases[phrase2] = (phrases[phrase2] || 0) + 1;
      if (i < sentenceWords.length - 2) {
        const phrase3 = `${sentenceWords[i]} ${sentenceWords[i + 1]} ${
          sentenceWords[i + 2]
        }`;
        if (!stopWords.has(sentenceWords[i + 2]))
          phrases[phrase3] = (phrases[phrase3] || 0) + 1;
      }
    }
  });

  const allTerms = { ...wordScores };
  Object.entries(phrases).forEach(([phrase, count]) => {
    if (count > 1) allTerms[phrase] = count * 2;
  });

  return Object.entries(allTerms)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([term]) => term)
    .filter((term) => term && term.length > 0);
}

function detectUniversalCategory(content, _fileType) {
  const categories = {
    technology: {
      keywords: [
        "tech",
        "innovation",
        "gadget",
        "software",
        "hardware",
        "AI",
        "computer",
        "internet",
        "digital",
        "future",
      ],
      weight: 2,
    },
    business: {
      keywords: [
        "company",
        "startup",
        "entrepreneur",
        "management",
        "strategy",
        "leadership",
        "economy",
        "commerce",
        "industry",
        "executive",
      ],
      weight: 2,
    },
    education: {
      keywords: [
        "learn",
        "teach",
        "school",
        "college",
        "student",
        "teacher",
        "curriculum",
        "classroom",
        "degree",
        "skill",
      ],
      weight: 2,
    },
    health: {
      keywords: [
        "wellness",
        "fitness",
        "nutrition",
        "diet",
        "exercise",
        "mental",
        "physical",
        "doctor",
        "therapy",
        "wellbeing",
      ],
      weight: 2,
    },
    science: {
      keywords: [
        "science",
        "discovery",
        "experiment",
        "theory",
        "research",
        "lab",
        "scientist",
        "fact",
        "universe",
        "knowledge",
      ],
      weight: 2,
    },
  };

  const contentLower = content.toLowerCase();
  let bestCategory = "other";
  let maxScore = 0;

  for (const [category, config] of Object.entries(categories)) {
    let score = 0;
    config.keywords.forEach((keyword) => {
      if (contentLower.includes(keyword)) {
        score += config.weight;
        const occurrences = contentLower.match(new RegExp(keyword, "g")) || [];
        if (occurrences.length > 1) score += (occurrences.length - 1) * 0.5;
      }
    });
    if (score > maxScore) {
      maxScore = score;
      bestCategory = category;
    }
  }
  return bestCategory;
}

function extractUniversalThemes(content) {
  const sentences = content.toLowerCase().split(/[.!?]+/);
  const themeCandidates = {};
  sentences.forEach((sentence) => {
    const words = sentence
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    for (let i = 0; i < words.length - 1; i++) {
      const phrase2 = `${words[i]} ${words[i + 1]}`;
      themeCandidates[phrase2] = (themeCandidates[phrase2] || 0) + 1;
      if (i < words.length - 2) {
        const phrase3 = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        themeCandidates[phrase3] = (themeCandidates[phrase3] || 0) + 1;
      }
    }
  });
  return Object.entries(themeCandidates)
    .filter(([, count]) => count > 1)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([theme]) => theme);
}

function generateUniversalSummary(content, _fileType) {
  if (content.length < 300) return content;
  const sentences = content
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
  const scoredSentences = sentences.map((sentence, index) => {
    let score = 0;
    if (index < 3) score += 2;
    if (index < sentences.length / 2) score += 1;
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount >= 8 && wordCount <= 25) score += 2;
    const importantWords = [
      "conclusion",
      "summary",
      "important",
      "key",
      "primary",
      "main",
      "essential",
    ];
    importantWords.forEach((word) => {
      if (sentence.toLowerCase().includes(word)) score += 2;
    });
    return { sentence, score, index };
  });
  const topSentences = scoredSentences
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.sentence);
  return topSentences.join(". ") + ".";
}

function calculateReadability(content) {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  const characters = content.replace(/\s/g, "").length;
  if (sentences.length === 0 || words.length === 0) return 0;
  const avgSentenceLength = words.length / sentences.length;
  const avgWordLength = characters / words.length;
  let score = 100 - (avgSentenceLength * 1.5 + avgWordLength * 10);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function detectLanguage(content) {
  const languagePatterns = {
    en: ["the", "and", "is", "in", "to", "of", "a", "that", "it", "with"],
    es: ["el", "la", "de", "que", "y", "en", "un", "es", "se", "no"],
    fr: ["le", "la", "de", "et", "à", "en", "un", "que", "est", "pour"],
    de: ["der", "die", "das", "und", "in", "den", "von", "zu", "dem", "mit"],
    it: ["il", "la", "di", "e", "che", "in", "un", "per", "sono", "con"],
  };
  const contentLower = content.toLowerCase();
  let bestLang = "en";
  let maxMatches = 0;
  for (const [lang, words] of Object.entries(languagePatterns)) {
    const matches = words.filter(
      (word) =>
        contentLower.includes(" " + word + " ") ||
        contentLower.startsWith(word + " ") ||
        contentLower.endsWith(" " + word)
    ).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      bestLang = lang;
    }
  }
  return bestLang;
}

async function getAccuratePageCount(filePath, fileType, content) {
  try {
    switch (fileType) {
      case "pdf":
        return await getPDFPageCount(filePath);

      case "docx":
        return await getDOCXPageCount(filePath, content);

      case "pptx":
        return await getPPTXPageCount(filePath);

      case "xlsx":
        return await getXLSXPageCount(filePath);

      case "csv":
        return 1; // CSV is typically single page

      default:
        return estimatePageCount(content);
    }
  } catch (error) {
    logger.error(
      `Error calculating page count for ${fileType}:`,
      error.message
    );
    return estimatePageCount(content);
  }
}

// ---------- NEW PDF PAGE COUNT (pdf-lib) ----------
async function getPDFPageCount(filePath) {
  try {
    const fs = await import("fs");
    const buffer = await fs.promises.readFile(filePath);
    const pdfDoc = await PDFDocument.load(buffer);
    const pageCount = pdfDoc.getPageCount();
    logger.info(`✓ PDF page count (pdf-lib): ${pageCount}`);
    return pageCount;
  } catch (error) {
    logger.error("Failed to get PDF page count (pdf-lib):", error.message);
    throw error;
  }
}

async function getDOCXPageCount(filePath, content) {
  try {
    // DOCX doesn't store explicit page count, estimate based on content
    // Average: 500 words per page or 3000 characters per page
    const wordCount = content.split(/\s+/).length;
    const charCount = content.length;

    const pagesByWords = Math.ceil(wordCount / 500);
    const pagesByChars = Math.ceil(charCount / 3000);

    // Use average of both methods
    const pageCount = Math.max(
      1,
      Math.round((pagesByWords + pagesByChars) / 2)
    );

    logger.info(
      `✓ DOCX estimated page count: ${pageCount} (${wordCount} words)`
    );
    return pageCount;
  } catch (error) {
    logger.error("Failed to estimate DOCX page count:", error.message);
    return 1;
  }
}

async function getPPTXPageCount(filePath) {
  try {
    const AdmZip = (await import("adm-zip")).default;
    const fs = await import("fs");

    const zipBuffer = await fs.promises.readFile(filePath);
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    // Count slide XML files
    const slideCount = zipEntries.filter(
      (entry) =>
        entry.entryName.startsWith("ppt/slides/slide") &&
        entry.entryName.endsWith(".xml")
    ).length;

    logger.info(`✓ PPTX page count: ${slideCount} slides`);
    return Math.max(1, slideCount);
  } catch (error) {
    logger.error("Failed to get PPTX page count:", error.message);
    return 1;
  }
}

async function getXLSXPageCount(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetCount = workbook.SheetNames.length;

    logger.info(`✓ XLSX page count: ${sheetCount} sheets`);
    return Math.max(1, sheetCount);
  } catch (error) {
    logger.error("Failed to get XLSX page count:", error.message);
    return 1;
  }
}

function estimatePageCount(content) {
  const wordCount = content.split(/\s+/).length;
  const charCount = content.length;
  const byWords = Math.max(1, Math.ceil(wordCount / 500));
  const byChars = Math.max(1, Math.ceil(charCount / 2500));
  return Math.round((byWords + byChars) / 2);
}

async function generateLocalEmbeddings(content, metadata) {
  try {
    if (!geminiEmbeddingAI) {
      logger.warn(
        "Skipping embedding generation: Gemini API key not configured"
      );
      return null;
    }

    // Truncate content to meet model limits (if any), though text-embedding-004 handles large context
    // efficiently. We'll use a safe chunk of text + critical metadata.
    const textToEmbed = `Title: ${metadata.title}
Description: ${metadata.description}
Keywords: ${metadata.tags.join(", ")}
Category: ${metadata.category}

Content:
${content.substring(0, 8000)}`.trim();

    const result = await geminiEmbeddingAI.models.embedContent({
      model: await getEmbeddingModel(),
      contents: textToEmbed,
    });

    const embedding = result.embeddings[0]?.values;

    if (!embedding) {
      throw new Error("No embedding values returned from API");
    }

    logger.info(`✓ Generated embedding with ${embedding.length} dimensions`);
    return embedding;
  } catch (error) {
    logger.error("Failed to generate embedding:", {
      error: error.message,
      stack: error.stack,
    });
    // Return null to allow processing to finish without embedding
    return null;
  }
}

async function cleanupTempFile(filePath) {
  if (!filePath) return;
  try {
    const fs = await import("fs");
    await fs.promises.unlink(filePath);
  } catch (error) {
    logger.warn(
      `Could not clean up temporary file ${filePath}:`,
      error.message
    );
  }
}
