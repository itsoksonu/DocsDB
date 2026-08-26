import express from "express";
import { param, query, validationResult } from "express-validator";
import mongoose from "mongoose";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import Document from "../../shared/models/Document.js";
import SavedDocument from "../../shared/models/SavedDocument.js";
import UserCollection from "../../shared/models/UserCollection.js";
import {
  enqueueProcessing,
  enqueueEmbedding,
} from "../../shared/queues/processQueue.js";
import { looksLikeObjectId } from "../../shared/utils/slug.js";
import { releaseStoredFile } from "../../shared/utils/storage.js";
import {
  getDocumentPreview,
  invalidateDocumentPreview,
} from "../../shared/utils/documentPreview.js";
import {
  buildContext,
  prepareDocumentIndex,
  invalidateDocumentIndex,
} from "../../shared/utils/documentIndex.js";
import {
  streamDocumentAnswer,
  MAX_QUESTION_CHARS,
} from "../../shared/utils/documentAi.js";
import { trackView, trackDownload } from "../../shared/utils/analytics.js";
import { getRedis } from "../../shared/utils/redis.js";
import S3Manager from "../../shared/utils/s3.js";
import s3 from "../../shared/utils/s3.js";
import logger from "../../shared/utils/logger.js";

const router = express.Router();

// Statuses a document can be requeued from. Anything else is moderated away or
// has no file behind it.
const RETRYABLE_STATUSES = new Set(["failed", "uploaded"]);
const MAX_MANUAL_RETRIES = 5;

// A worker that dies mid-run leaves the document at "processing" with no job to
// move it, and nothing ever clears it. Past this age we assume the run is dead
// and let it be requeued; the job-id de-duplication in enqueueProcessing stops
// a genuinely live run from being doubled up.
const STALE_PROCESSING_MS = 30 * 60 * 1000;

// Hard ceiling on one Ask AI answer. A provider that stops sending tokens
// half-way would otherwise hold the connection open until the socket dies.
const ASK_TIMEOUT_MS = 90 * 1000;

function isStuckInProcessing(document) {
  if (document.status !== "processing") return false;

  const startedAt = document.processingStartedAt || document.updatedAt;
  if (!startedAt) return true;

  return Date.now() - new Date(startedAt).getTime() > STALE_PROCESSING_MS;
}


// Helper function to add signed thumbnails
async function addSignedThumbnails(documents) {
  if (!documents || documents.length === 0) return documents;

  return await Promise.all(
    documents.map(async (doc) => {
      doc = doc.toObject ? doc.toObject() : doc;

      if (doc.thumbnailS3Path) {
        doc.thumbnailUrl = await s3.generateViewUrl(doc.thumbnailS3Path);
      }

      return doc;
    }),
  );
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Saved-document cursors carry the sort key, so paging stays correct even when
// the user saves or unsaves something between pages.
function encodeSavedCursor(row) {
  return Buffer.from(
    `${new Date(row.savedAt).toISOString()}|${row._id}`,
  ).toString("base64url");
}

function decodeSavedCursor(cursor) {
  if (!cursor) return null;
  try {
    const [savedAt, id] = Buffer.from(cursor, "base64url")
      .toString("utf8")
      .split("|");
    const date = new Date(savedAt);
    if (Number.isNaN(date.getTime()) || !mongoose.isValidObjectId(id)) {
      return null;
    }
    return { savedAt: date, id: new mongoose.Types.ObjectId(id) };
  } catch {
    return null;
  }
}

/**
 * Documents are addressed by slug in public URLs, but every old link, every
 * bookmark and the admin panel still use the id. Both resolve here.
 *
 * `builder` receives the query so callers can populate/select as they need.
 */
async function findByIdOrSlug(identifier, builder = (q) => q) {
  if (looksLikeObjectId(identifier)) {
    return builder(Document.findById(identifier));
  }
  return builder(Document.findOne({ slug: String(identifier).toLowerCase() }));
}

// Slugs are lowercase alphanumerics and dashes; ids are 24 hex characters.
// Anything else never reaches the database.
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/i;

function isValidIdentifier(value) {
  return IDENTIFIER_PATTERN.test(String(value || ""));
}

// Get document by ID or slug
router.get(
  "/:id",
  optionalAuthMiddleware,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!isValidIdentifier(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const userId = req.user?.userId;

      const document = await findByIdOrSlug(id, (q) =>
        q.populate("userId", "name avatar"),
      );

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      // Check permissions:
      // 1. If document is viewable (public), allow access
      // 2. If document is private, user must be the owner
      const isOwner = userId && document.userId._id.toString() === userId;

      if (!document.isViewable() && !isOwner) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this document",
        });
      }

      trackView(document._id, userId, req.ip).catch((error) => {
        logger.error("Error tracking view:", error);
      });

      res.json({
        success: true,
        data: { document },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get document content for viewing
router.get(
  "/:id/view",
  optionalAuthMiddleware,
  [query("page").optional().isInt({ min: 1 })],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const { id } = req.params;

      if (!errors.isEmpty() || !isValidIdentifier(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid parameters",
        });
      }

      const { page } = req.query;
      const userId = req.user?.userId;

      const document = await findByIdOrSlug(id, (q) =>
        q.populate("userId", "name avatar"),
      );

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      // userId is populated above, so the id lives one level down. Comparing
      // against the populated document never matched, which locked owners out
      // of their own private documents.
      const isOwner = userId && document.userId?._id?.toString() === userId;

      if (!document.isViewable() && !isOwner) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this document",
        });
      }

      // Track view
      trackView(document._id, userId, req.ip).catch((error) => {
        logger.error("Error tracking view:", error);
      });

      let viewUrl;
      try {
        viewUrl = await s3.generateViewUrl(document.s3Path);

        if (!viewUrl) {
          viewUrl = await S3Manager.generateDownloadUrl(
            document.s3Path,
            document.originalFilename,
            3600,
          );
        }
      } catch (error) {
        logger.error("Error generating view URL:", error);
        viewUrl = document.s3Path
          ? `https://your-bucket.s3.amazonaws.com/${document.s3Path}`
          : null;
      }

      const viewerData = await getViewerData(document, page);

      const docObj = document.toObject();
      if (docObj.userId && docObj.userId.avatar) {
        docObj.userId.avatar = await s3.generateViewUrl(docObj.userId.avatar);
      }

      res.json({
        success: true,
        data: {
          document: docObj,
          viewUrl: viewUrl || null,
          viewerData,
          expiresIn: 3600,
        },
      });
    } catch (error) {
      logger.error("Error in document view endpoint:", error);
      next(error);
    }
  },
);

// Get user's documents
router.get(
  "/user/my-documents",
  authMiddleware,
  [
    query("cursor").optional().isString(),
    query("limit").optional().isInt({ min: 1, max: 50 }).default(20),
    query("status")
      .optional()
      .isIn(["uploaded", "processing", "processed", "failed", "all"])
      .default("all"),
    query("search").optional().isString().trim(),
  ],
  rateLimitMiddleware("search"),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid parameters" });
      }

      const { cursor, limit, status, search } = req.query;
      const userId = req.user.userId;

      const cacheKey = `mydocs:${userId}:${status}:${search || "all"}:${
        cursor || "initial"
      }:${limit}`;

      if (getRedis()) {
        const cached = await getRedis().get(cacheKey);
        if (cached) {
          return res.json({ success: true, data: JSON.parse(cached) });
        }
      }

      let query = { userId };
      if (status !== "all") {
        query.status = status;
      } else {
        query.status = { $ne: "deleted" };
      }

      if (search) {
        query.$or = [
          { originalFilename: { $regex: search, $options: "i" } },
          { generatedTitle: { $regex: search, $options: "i" } },
        ];
      }

      const mongoQuery = Document.find(query)
        .sort({ _id: -1 })
        .limit(parseInt(limit) + 1);
      if (cursor) mongoQuery.where("_id").lt(cursor);

      let docs = await mongoQuery
        .select("-metadata -embeddingsId")
        .populate("userId", "name");

      const hasMore = docs.length > limit;
      if (hasMore) docs = docs.slice(0, limit);

      docs = await addSignedThumbnails(docs);

      const response = {
        documents: docs,
        cursor: cursor || null,
        nextCursor: hasMore ? docs[docs.length - 1]._id : null,
      };

      if (getRedis() && docs.length > 0) {
        await getRedis().setEx(cacheKey, 120, JSON.stringify(response));
      }

      res.json({ success: true, data: response });
    } catch (error) {
      next(error);
    }
  },
);

// Track document download
router.post(
  "/:id/track-download",
  optionalAuthMiddleware,
  [param("id").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const { id } = req.params;
      const userId = req.user?.userId;

      // Track the download
      const tracked = await trackDownload(id, userId, req.ip);

      res.json({
        success: true,
        tracked,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Update document metadata
router.patch(
  "/:id",
  authMiddleware,
  [param("id").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const { id } = req.params;
      const userId = req.user.userId;
      const updates = req.body;

      const allowedUpdates = [
        "generatedTitle",
        "generatedDescription",
        "tags",
        "category",
        "visibility",
        "monetizationEnabled",
      ];

      const updateData = {};
      allowedUpdates.forEach((field) => {
        if (updates[field] !== undefined) {
          updateData[field] = updates[field];
        }
      });

      const document = await Document.findOne({ _id: id, userId });
      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found or access denied",
        });
      }

      const updatedDocument = await Document.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true },
      ).select("-metadata -embeddingsId");

      res.json({
        success: true,
        message: "Document updated successfully",
        data: { document: updatedDocument },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Delete document
router.delete(
  "/:id",
  authMiddleware,
  [param("id").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const { id } = req.params;
      const userId = req.user.userId;

      const document = await Document.findOne({ _id: id, userId });
      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found or access denied",
        });
      }

      try {
        // Documents can share one S3 object when their bytes are identical, so
        // this releases a reference rather than deleting outright. The object
        // goes only when the last document referencing it goes.
        await releaseStoredFile({
          documentId: document._id,
          fileHash: document.fileHash,
          s3Path: document.s3Path,
          thumbnailS3Path: document.thumbnailS3Path,
        });
      } catch (s3Error) {
        logger.error(`Failed to release storage for document ${id}:`, s3Error);
        // Continue with DB deletion even if S3 fails, but log it
      }

      document.status = "deleted";
      await document.save();

      // The retrieval passages hold a copy of the document's text, so they go
      // with it rather than sitting in the collection unreferenced.
      await invalidateDocumentIndex(document._id);

      res.json({
        success: true,
        message: "Document deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get document analytics
router.get(
  "/:id/analytics",
  optionalAuthMiddleware,
  [param("id").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const { id } = req.params;
      const userId = req.user?.userId;

      const document = await Document.findById(id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      const isOwner = userId && document.userId.toString() === userId;

      if (!document.isViewable() && !isOwner) {
        return res.status(404).json({
          success: false,
          message: "Document not found or access denied",
        });
      }

      // Get analytics data (simplified - in production would use proper analytics DB)
      const analytics = await getDocumentAnalytics(id);

      res.json({
        success: true,
        data: {
          document: {
            viewsCount: document.viewsCount,
            downloadsCount: document.downloadsCount,
            createdAt: document.createdAt,
          },
          analytics,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Helper functions
async function getViewerData(document, page = 1) {
  const baseData = {
    fileType: document.fileType,
    totalPages: document.pageCount || 1,
    currentPage: Math.min(page, document.pageCount || 1),
  };

  switch (document.fileType) {
    case "pdf":
      return {
        ...baseData,
        viewerType: "pdf",
        supports: ["zoom", "navigation", "search"],
      };
    case "docx":
      return {
        ...baseData,
        viewerType: "html",
        supports: ["reading", "search"],
      };
    case "pptx":
      return {
        ...baseData,
        viewerType: "slides",
        supports: ["navigation", "fullscreen"],
      };
    case "xlsx":
    case "csv":
      return {
        ...baseData,
        viewerType: "spreadsheet",
        supports: ["filtering", "sorting", "search"],
      };
    default:
      return {
        ...baseData,
        viewerType: "download",
        supports: [],
      };
  }
}

async function getDocumentAnalytics(documentId) {
  // Simplified analytics - in production, use proper analytics database
  try {
    const cacheKey = `analytics:doc:${documentId}`;

    if (getRedis()) {
      const cached = await getRedis().get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    // Mock analytics data
    const analytics = {
      viewsLast7Days: Math.floor(Math.random() * 100),
      downloadsLast7Days: Math.floor(Math.random() * 20),
      averageViewTime: Math.floor(Math.random() * 300),
      geographicData: [
        { country: "US", views: Math.floor(Math.random() * 50) },
        { country: "UK", views: Math.floor(Math.random() * 30) },
        { country: "CA", views: Math.floor(Math.random() * 20) },
      ],
    };

    if (getRedis()) {
      await getRedis().setEx(cacheKey, 3600, JSON.stringify(analytics));
    }

    return analytics;
  } catch (error) {
    logger.error("Error getting document analytics:", error);
    return {};
  }
}

// Renderable content for the in-app viewer. Only non-PDF types need this:
// PDFs are rendered straight from the signed S3 URL.
router.get(
  "/:id/preview",
  optionalAuthMiddleware,
  rateLimitMiddleware("search"),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!isValidIdentifier(id)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid document ID" });
      }

      const userId = req.user?.userId;
      const document = await findByIdOrSlug(id);

      if (!document) {
        return res
          .status(404)
          .json({ success: false, message: "Document not found" });
      }

      const isOwner = userId && document.userId.toString() === userId;

      if (!document.isViewable() && !isOwner) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this document",
        });
      }

      const preview = await getDocumentPreview(document);

      res.json({ success: true, data: preview });
    } catch (error) {
      logger.error("Error building document preview:", error);
      res.status(502).json({
        success: false,
        message: "Could not build a preview for this document",
      });
    }
  },
);

// Warm a document's retrieval index. Called when the Ask AI panel is opened,
// so extraction, embedding and vector loading happen while the user is typing
// instead of adding seconds to their first question. Idempotent and cheap once
// the index exists.
router.post(
  "/:id/ask/prepare",
  authMiddleware,
  rateLimitMiddleware("aiPrepare"),
  async (req, res) => {
    const startedAt = Date.now();

    try {
      const { id } = req.params;

      if (!isValidIdentifier(id)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid document ID" });
      }

      const document = await findByIdOrSlug(id);

      if (!document) {
        return res
          .status(404)
          .json({ success: false, message: "Document not found" });
      }

      const isOwner = document.userId.toString() === req.user.userId;

      if (!document.isViewable() && !isOwner) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this document",
        });
      }

      if (!document.s3Path) {
        return res.status(409).json({
          success: false,
          message: "The original file is no longer available",
        });
      }

      const prepared = await prepareDocumentIndex(document);

      if (!prepared) {
        // Told now rather than after the user has typed a question and waited.
        return res.status(422).json({
          success: false,
          message:
            "This document has no readable text, so AI cannot answer questions about it.",
        });
      }

      // Passages still without a vector become a queued job rather than work
      // done here: it takes minutes on a rate-limited tier, and it must finish
      // whether or not the reader stays on the page. The stable job id means
      // this is safe to call on every panel open.
      if (prepared.remaining > 0) {
        try {
          await enqueueEmbedding(document._id);
        } catch (error) {
          // The document is still answerable from its opening section, so a
          // queue problem is not worth failing the request over.
          logger.error(
            `Ask AI: could not queue embedding for ${document._id}:`,
            error,
          );
        }
      }

      logger.info(
        `Ask AI prepare ${document._id} passages=${
          prepared.chunkCount
        } pending=${prepared.remaining} mode=${prepared.mode} cache=${
          prepared.cache
        } index=${prepared.timings.indexMs}ms load=${
          prepared.timings.loadMs
        }ms total=${Date.now() - startedAt}ms`,
      );

      res.json({
        success: true,
        data: {
          // False while passages are still being embedded: questions are
          // answerable, but from the document's opening section only.
          ready: prepared.remaining === 0,
          mode: prepared.mode,
          truncated: prepared.truncated,
          remaining: prepared.remaining,
        },
      });
    } catch (error) {
      logger.error("Ask AI prepare failed:", error);
      res.status(502).json({
        success: false,
        message: "Could not read this document. Please try again later.",
      });
    }
  },
);

// "Ask AI": answer a question about one document, streamed as Server-Sent
// Events so the answer appears as it is generated instead of after ten seconds
// of nothing.
//
// Every failure that can be detected up front (permissions, an unreadable file,
// a bad question) is answered with an ordinary JSON status code. The event
// stream is only opened once the answer is actually about to start, because
// once headers are sent the status code is fixed at 200.
router.post(
  "/:id/ask",
  authMiddleware,
  rateLimitMiddleware("ai"),
  async (req, res, next) => {
    const requestStartedAt = Date.now();

    try {
      const { id } = req.params;

      if (!isValidIdentifier(id)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid document ID" });
      }

      const question = String(req.body?.question || "").trim();

      if (!question) {
        return res
          .status(400)
          .json({ success: false, message: "Please enter a question" });
      }

      if (question.length > MAX_QUESTION_CHARS) {
        return res.status(400).json({
          success: false,
          message: `Questions are limited to ${MAX_QUESTION_CHARS} characters`,
        });
      }

      const document = await findByIdOrSlug(id);

      if (!document) {
        return res
          .status(404)
          .json({ success: false, message: "Document not found" });
      }

      const isOwner = document.userId.toString() === req.user.userId;

      if (!document.isViewable() && !isOwner) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this document",
        });
      }

      if (!document.s3Path) {
        return res.status(409).json({
          success: false,
          message: "The original file is no longer available",
        });
      }

      // Retrieval, not the first N characters: the passages relevant to this
      // question. The first question about a document also builds its index,
      // which is why this happens before the stream is opened - a failure here
      // is still a real status code rather than an error event.
      let context;
      try {
        context = await buildContext(document, {
          question,
          history: Array.isArray(req.body?.history) ? req.body.history : [],
        });
      } catch (error) {
        logger.error(`Ask AI context build failed for ${document._id}:`, error);
        return res.status(502).json({
          success: false,
          message: "Could not read this document. Please try again later.",
        });
      }

      if (!context) {
        // Scanned images, an empty spreadsheet, a deck of pictures. The
        // pipeline can OCR these; a request cannot wait that long.
        return res.status(422).json({
          success: false,
          message:
            "This document has no readable text, so AI cannot answer questions about it.",
        });
      }

      // compression() buffers a response until it has a full block, which would
      // hold every token back; "no-transform" tells it to leave this one alone.
      // X-Accel-Buffering does the same for an nginx proxy in front.
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();

      // A token can already be in flight when the client disconnects, and
      // writing to a destroyed response emits an unhandled error.
      const send = (event, data) => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const controller = new AbortController();

      // The client closing the tab, or pressing stop, must stop us paying a
      // provider for tokens nobody will read.
      req.on("close", () => controller.abort());

      const streamStartedAt = Date.now();
      let firstTokenAt = 0;

      const timeout = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);

      try {
        send("meta", {
          mode: context.mode,
          truncated: context.truncated,
          totalChars: context.totalChars,
        });

        // Sent before the answer so the panel can show what it was built from
        // even if generation then fails half-way.
        if (context.sources.length) {
          send("sources", { sources: context.sources });
        }

        const { cut, promptChars } = await streamDocumentAnswer({
          document,
          context,
          question,
          history: req.body?.history,
          signal: controller.signal,
          onToken: (token) => {
            if (!firstTokenAt) firstTokenAt = Date.now();
            send("token", { text: token });
          },
          onProvider: (provider) => send("provider", { provider }),
        });

        // `cut` means the model stopped at the token ceiling, so the panel can
        // say the answer is incomplete rather than leaving a hanging sentence.
        send("done", { cut });

        // The wait before the first token is what users feel. Attributing it -
        // indexing, embedding the question, loading passages, or the provider
        // itself - is otherwise guesswork.
        const t = context.timings || {};
        logger.info(
          `Ask AI ${document._id} mode=${context.mode} passages=${
            context.blocks.length
          } prompt=~${Math.round(promptChars / 4)}tok cache=${t.cache} index=${
            t.indexMs
          }ms embed=${t.embedMs}ms(${
            t.queryCache || "n/a"
          }) load=${t.loadMs}ms select=${t.selectMs}ms provider=${
            firstTokenAt ? firstTokenAt - streamStartedAt : "n/a"
          }ms total=${Date.now() - requestStartedAt}ms`,
        );
      } catch (error) {
        logger.error(`Ask AI failed for ${document._id}:`, error);
        send("error", {
          message:
            "The AI assistant is unavailable right now. Please try again.",
        });
      } finally {
        clearTimeout(timeout);
        res.end();
      }
    } catch (error) {
      next(error);
    }
  },
);

// Retry processing for a document that failed, or that got stuck before a
// worker ever picked it up. Reuses the existing S3 object - the user does not
// have to upload the file again.
router.post(
  "/:id/reprocess",
  authMiddleware,
  [param("id").isMongoId()],
  rateLimitMiddleware("write"),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const { id } = req.params;
      const userId = req.user.userId;
      const isAdmin = req.user.role === "admin";

      const document = await Document.findById(id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      if (!isAdmin && document.userId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to reprocess this document",
        });
      }

      if (document.status === "deleted") {
        return res.status(410).json({
          success: false,
          message: "This document has been deleted",
        });
      }

      // Quarantined and taken-down documents failed moderation, not
      // processing. Requeueing them would launder that decision.
      if (
        !RETRYABLE_STATUSES.has(document.status) &&
        !isStuckInProcessing(document)
      ) {
        return res.status(409).json({
          success: false,
          message:
            document.status === "processing"
              ? "This document is already being processed"
              : `Documents with status "${document.status}" cannot be reprocessed`,
        });
      }

      if (!document.s3Path) {
        return res.status(409).json({
          success: false,
          message: "The original file is no longer available",
        });
      }

      // Processing is expensive (OCR, AI metadata, embeddings). Admins can keep
      // going; owners get a bounded number of tries.
      if (!isAdmin && document.retryCount >= MAX_MANUAL_RETRIES) {
        return res.status(429).json({
          success: false,
          message: `This document has already been retried ${MAX_MANUAL_RETRIES} times. Please contact support.`,
        });
      }

      // Confirm the object is really still in S3 before promising the user
      // anything - otherwise the retry just fails again a minute later.
      const exists = await S3Manager.objectExists(document.s3Path);
      if (!exists) {
        return res.status(409).json({
          success: false,
          message:
            "The uploaded file is missing from storage. Please upload it again.",
        });
      }

      document.status = "processing";
      document.processingError = undefined;
      document.processingStartedAt = new Date();
      document.retryCount = (document.retryCount || 0) + 1;
      await document.save();

      await invalidateDocumentPreview(document._id);
      await invalidateDocumentIndex(document._id);

      try {
        await enqueueProcessing(document._id, document.s3Path);
      } catch (error) {
        document.status = "failed";
        document.processingError =
          "Could not queue the document for processing. Please retry.";
        await document.save();
        throw error;
      }

      res.json({
        success: true,
        message: "Document queued for reprocessing",
        data: {
          documentId: document._id,
          status: document.status,
          retryCount: document.retryCount,
          retriesRemaining: isAdmin
            ? null
            : Math.max(0, MAX_MANUAL_RETRIES - document.retryCount),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Save document
router.post(
  "/:id/save",
  authMiddleware,
  [param("id").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const { id } = req.params;
      const userId = req.user.userId;

      const document = await Document.findById(id);
      if (!document || !document.isViewable()) {
        return res.status(404).json({
          success: false,
          message: "Document not found or not accessible",
        });
      }

      // Check if collectionId is provided
      const { collectionId } = req.body;

      // Validate collection if provided
      if (collectionId) {
        if (!mongoose.isValidObjectId(collectionId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid collection ID",
          });
        }
        const collectionExists = await UserCollection.exists({
          _id: collectionId,
          userId,
        });
        if (!collectionExists) {
          return res.status(404).json({
            success: false,
            message: "Collection not found",
          });
        }
      }

      await SavedDocument.updateOne(
        { userId, documentId: id },
        {
          $set: { collectionId: collectionId || null },
          $setOnInsert: { userId, documentId: id, savedAt: new Date() },
        },
        { upsert: true },
      );

      res.json({
        success: true,
        message: "Document saved successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Unsave document
router.delete(
  "/:id/save",
  authMiddleware,
  [param("id").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const { id } = req.params;
      const userId = req.user.userId;

      await SavedDocument.deleteOne({ userId, documentId: id });

      res.json({
        success: true,
        message: "Document unsaved successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Check save status
router.get(
  "/:id/save/status",
  authMiddleware,
  [param("id").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const { id } = req.params;
      const userId = req.user.userId;

      const savedDoc = await SavedDocument.findOne({ userId, documentId: id })
        .select("collectionId")
        .lean();

      res.json({
        success: true,
        data: {
          isSaved: !!savedDoc,
          collectionId: savedDoc ? savedDoc.collectionId : null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get user collections
router.get("/user/collections", authMiddleware, async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);

    const collections = await UserCollection.find({ userId })
      .sort({ createdAt: 1 })
      .lean();

    if (collections.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Counts and cover thumbnails are two small indexed aggregations rather
    // than loading every saved document into memory.
    const notDeleted = {
      $lookup: {
        from: "documents",
        let: { docId: "$documentId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$docId"] },
              status: { $ne: "deleted" },
            },
          },
          { $project: { thumbnailS3Path: 1 } },
        ],
        as: "doc",
      },
    };

    const [counts, covers] = await Promise.all([
      SavedDocument.aggregate([
        { $match: { userId, collectionId: { $ne: null } } },
        notDeleted,
        { $unwind: "$doc" },
        { $group: { _id: "$collectionId", documentCount: { $sum: 1 } } },
      ]),
      SavedDocument.aggregate([
        { $match: { userId, collectionId: { $ne: null } } },
        { $sort: { savedAt: -1 } },
        notDeleted,
        { $unwind: "$doc" },
        { $match: { "doc.thumbnailS3Path": { $nin: [null, ""] } } },
        {
          $group: {
            _id: "$collectionId",
            thumbnailS3Path: { $first: "$doc.thumbnailS3Path" },
          },
        },
      ]),
    ]);

    const countById = new Map(counts.map((c) => [String(c._id), c.documentCount]));
    const coverById = new Map(
      covers.map((c) => [String(c._id), c.thumbnailS3Path]),
    );

    const collectionsWithMeta = await Promise.all(
      collections.map(async (collection) => {
        const key = String(collection._id);
        let thumbnailUrl = null;
        const coverKey = coverById.get(key);

        if (coverKey) {
          try {
            thumbnailUrl = await s3.generateViewUrl(coverKey);
          } catch (err) {
            logger.error(
              `Error generating thumbnail for collection preview: ${err}`,
            );
          }
        }

        return {
          ...collection,
          documentCount: countById.get(key) || 0,
          thumbnailUrl,
        };
      }),
    );

    res.json({
      success: true,
      data: collectionsWithMeta,
    });
  } catch (error) {
    next(error);
  }
});

// Create new collection
router.post("/user/collections", authMiddleware, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Collection name is required",
      });
    }

    const userId = req.user.userId;

    // The {userId, name} unique index is case-insensitive, so a duplicate is a
    // write error rather than a read-then-write race.
    let newCollection;
    try {
      newCollection = await UserCollection.create({
        userId,
        name: name.trim(),
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: "Collection already exists",
        });
      }
      throw error;
    }

    res.json({
      success: true,
      data: newCollection,
    });
  } catch (error) {
    next(error);
  }
});

// Update collection name
router.put(
  "/user/collections/:id",
  authMiddleware,
  [param("id").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid collection ID" });
      }

      const { id } = req.params;
      const { name } = req.body;

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Collection name is required",
        });
      }

      const userId = req.user.userId;

      let collection;
      try {
        collection = await UserCollection.findOneAndUpdate(
          { _id: id, userId },
          { $set: { name: name.trim() } },
          { new: true },
        );
      } catch (error) {
        if (error.code === 11000) {
          return res.status(400).json({
            success: false,
            message: "Collection with this name already exists",
          });
        }
        throw error;
      }

      if (!collection) {
        return res
          .status(404)
          .json({ success: false, message: "Collection not found" });
      }

      res.json({
        success: true,
        data: collection,
        message: "Collection updated successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get user's saved documents
router.get(
  "/user/saved-documents",
  authMiddleware,
  [
    query("cursor").optional().isString(),
    query("limit").optional().isInt({ min: 1, max: 50 }).default(20),
    query("search").optional().isString().trim(),
    query("collectionId").optional().isString(),
  ],
  rateLimitMiddleware("search"),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid parameters" });
      }

      const { cursor, limit, search, collectionId } = req.query;
      const userId = req.user.userId;

      const cacheKey = `saveddocs:${userId}:${search || "all"}:${
        collectionId || "all"
      }:${cursor || "initial"}:${limit}`;

      if (getRedis()) {
        const cached = await getRedis().get(cacheKey);
        if (cached) {
          return res.json({ success: true, data: JSON.parse(cached) });
        }
      }

      const pageSize = parseInt(limit) || 20;

      const match = { userId: new mongoose.Types.ObjectId(userId) };

      if (collectionId && collectionId !== "all") {
        if (collectionId === "uncategorized") {
          match.collectionId = null;
        } else if (mongoose.isValidObjectId(collectionId)) {
          match.collectionId = new mongoose.Types.ObjectId(collectionId);
        } else {
          return res
            .status(400)
            .json({ success: false, message: "Invalid collection ID" });
        }
      }

      // Keyset pagination on the {userId, savedAt:-1} index - the sort is
      // served by the index, so nothing is loaded or sorted in memory.
      const decoded = decodeSavedCursor(cursor);
      if (cursor && !decoded) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid cursor" });
      }
      if (decoded) {
        match.$or = [
          { savedAt: { $lt: decoded.savedAt } },
          { savedAt: decoded.savedAt, _id: { $lt: decoded.id } },
        ];
      }

      const documentMatch = {
        $expr: { $eq: ["$_id", "$$docId"] },
        status: "processed",
        visibility: "public",
      };

      if (search) {
        const searchRegex = new RegExp(escapeRegex(search), "i");
        documentMatch.$or = [
          { generatedTitle: searchRegex },
          { originalFilename: searchRegex },
        ];
      }

      const rows = await SavedDocument.aggregate([
        { $match: match },
        { $sort: { savedAt: -1, _id: -1 } },
        {
          $lookup: {
            from: "documents",
            let: { docId: "$documentId" },
            pipeline: [
              { $match: documentMatch },
              { $project: { embedding: 0 } },
            ],
            as: "doc",
          },
        },
        { $unwind: "$doc" },
        { $limit: pageSize + 1 },
        {
          $lookup: {
            from: "users",
            let: { ownerId: "$doc.userId" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$ownerId"] } } },
              { $project: { name: 1, avatar: 1 } },
            ],
            as: "owner",
          },
        },
      ]);

      const hasMore = rows.length > pageSize;
      const page = hasMore ? rows.slice(0, pageSize) : rows;

      const docsWithThumb = await addSignedThumbnails(
        page.map((row) => ({
          savedAt: row.savedAt,
          ...row.doc,
          userId: row.owner?.[0] || row.doc.userId,
        })),
      );

      const last = page[page.length - 1];

      const response = {
        documents: docsWithThumb,
        cursor: cursor || null,
        nextCursor: hasMore && last ? encodeSavedCursor(last) : null,
      };

      if (getRedis() && page.length > 0) {
        await getRedis().setEx(cacheKey, 180, JSON.stringify(response));
      }

      res.json({ success: true, data: response });
    } catch (error) {
      next(error);
    }
  },
);

// Get user stats
router.get("/user/stats", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const [uploadedCount, savedCount] = await Promise.all([
      Document.countDocuments({ userId, status: { $ne: "deleted" } }),
      SavedDocument.countDocuments({ userId }),
    ]);

    res.json({
      success: true,
      data: {
        uploadedCount,
        savedCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
