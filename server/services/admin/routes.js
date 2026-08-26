import express from "express";
import mongoose from "mongoose";
import { param, query, body, validationResult } from "express-validator";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import User from "../../shared/models/User.js";
import UserWallet from "../../shared/models/UserWallet.js";
import Document, { DOCUMENT_CATEGORIES } from "../../shared/models/Document.js";
import Payouts from "../../shared/models/Payouts.js";
import Report from "../../shared/models/Report.js";
import {
  processReport,
  generateAdminStats,
  takeDownDocument,
  restoreDocument,
} from "../../shared/utils/moderationEngine.js";
import logger from "../../shared/utils/logger.js";
import { escapeRegex } from "../../shared/utils/regex.js";
import s3 from "../../shared/utils/s3.js";
import databaseManager from "../../shared/database/connection.js";
import { cachedCount } from "../../shared/utils/cachedCount.js";
import SavedDocument from "../../shared/models/SavedDocument.js";
import Earnings from "../../shared/models/Earnings.js";
import { getDocumentViewStats } from "../../shared/utils/analytics.js";
import { enqueueProcessing } from "../../shared/queues/processQueue.js";
import { invalidateDocumentPreview } from "../../shared/utils/documentPreview.js";
import { invalidateDocumentIndex } from "../../shared/utils/documentIndex.js";
import {
  regenerateThumbnail,
  checkMetadataProviders,
  testMetadataProvider,
  testEmbeddingModel,
} from "../../shared/utils/documentProcessor.js";
import { AI_PROVIDERS } from "../../shared/models/AiSettings.js";
import { getAiSettings, updateAiSettings } from "../../shared/utils/aiSettings.js";
import { listAllModels } from "../../shared/utils/aiModelCatalog.js";

const router = express.Router();

// rateLimitMiddleware was imported here but never applied to a single one of the
// 19 admin routes. These are all auth + role gated, so this is defence in depth
// rather than the primary control - but several of them are expensive
// (aggregations, thumbnail regeneration, reprocess enqueues) and a compromised
// or careless admin session should not be able to hammer them. Applied to the
// whole router so no future route can be added without it.
router.use(rateLimitMiddleware("api"));

// Admin dashboard statistics
router.get(
  "/dashboard",
  authMiddleware,
  requireRole(["admin"]),
  async (req, res, next) => {
    try {
      const stats = await generateAdminStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get moderation queue
router.get(
  "/moderation/queue",
  authMiddleware,
  requireRole(["admin", "moderator"]),
  [
    query("status")
      .optional()
      .isIn(["pending", "approved", "rejected", "escalated"])
      .default("pending"),
    query("type").optional().isIn(["upload", "report", "dmca"]),
    query("page").optional().isInt({ min: 1, max: 1000 }).default(1),
    query("limit").optional().isInt({ min: 1, max: 100 }).default(50),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { status, type, page, limit } = req.query;
      const skip = (page - 1) * limit;

      const query = { status };
      if (type) {
        query.type = type;
      }

      const [queueItems, total] = await Promise.all([
        Report.find(query)
          .populate("reporterId", "name email")
          .populate("documentId", "generatedTitle fileType userId")
          .populate("targetUserId", "name email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Report.countDocuments(query),
      ]);

      res.json({
        success: true,
        data: {
          queueItems,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            hasMore: skip + queueItems.length < total,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Process moderation item
router.post(
  "/moderation/:reportId/process",
  authMiddleware,
  requireRole(["admin", "moderator"]),
  [
    param("reportId").isMongoId(),
    body("action").isIn(["approve", "reject", "escalate", "request_more_info"]),
    body("reason").optional().trim().isLength({ max: 1000 }),
    body("severity").optional().isIn(["low", "medium", "high", "critical"]),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { reportId } = req.params;
      const { action, reason, severity } = req.body;
      const moderatorId = req.user.userId;

      const result = await processReport(reportId, {
        action,
        reason,
        severity,
        moderatorId,
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      res.json({
        success: true,
        message: `Report ${action}ed successfully`,
        data: {
          report: result.report,
          actionsTaken: result.actionsTaken,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Take down document (immediate action)
router.post(
  "/documents/:documentId/takedown",
  authMiddleware,
  requireRole(["admin"]),
  [
    param("documentId").isMongoId(),
    body("reason").notEmpty().trim().isLength({ max: 500 }),
    body("notifyUser").optional().isBoolean().default(true),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { documentId } = req.params;
      const { reason, notifyUser } = req.body;
      const adminId = req.user.userId;

      const result = await takeDownDocument(documentId, {
        reason,
        notifyUser,
        adminId,
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      res.json({
        success: true,
        message: "Document taken down successfully",
        data: {
          document: result.document,
          notificationSent: result.notificationSent,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Restore taken down document
router.post(
  "/documents/:documentId/restore",
  authMiddleware,
  requireRole(["admin"]),
  [
    param("documentId").isMongoId(),
    body("reason").optional().trim().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { documentId } = req.params;
      const { reason } = req.body;
      const adminId = req.user.userId;

      const result = await restoreDocument(documentId, {
        reason,
        adminId,
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      res.json({
        success: true,
        message: "Document restored successfully",
        data: {
          document: result.document,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// User management
router.get(
  "/users",
  authMiddleware,
  requireRole(["admin"]),
  [
    query("page").optional().isInt({ min: 1, max: 1000 }).default(1),
    query("limit").optional().isInt({ min: 1, max: 100 }).default(50),
    query("search").optional().trim().isLength({ max: 100 }),
    query("role").optional().isIn(["user", "creator", "moderator", "admin"]),
    query("status").optional().isIn(["active", "suspended", "banned"]),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { page, limit, search, role, status } = req.query;
      const skip = (page - 1) * limit;

      const query = {};
      if (role) query.role = role;
      if (status) query.status = status;

      if (search) {
        const safeSearch = escapeRegex(search);
        query.$or = [
          { name: { $regex: safeSearch, $options: "i" } },
          { email: { $regex: safeSearch, $options: "i" } },
        ];
      }

      const [users, total] = await Promise.all([
        User.find(query)
          .select("name email role status avatar createdAt")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        User.countDocuments(query),
      ]);

      const usersWithSignedAvatars = await Promise.all(
        users.map(async (user) => {
          const userObj = user.toObject();
          if (userObj.avatar && !userObj.avatar.startsWith("http")) {
            try {
              userObj.avatar = await s3.generateViewUrl(userObj.avatar);
            } catch (error) {
              console.error(
                `Error generating avatar URL for user ${user._id}:`,
                error,
              );
            }
          }
          return userObj;
        }),
      );

      res.json({
        success: true,
        data: {
          users: usersWithSignedAvatars,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            hasMore: skip + users.length < total,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Update user status
router.patch(
  "/users/:userId/status",
  authMiddleware,
  requireRole(["admin"]),
  [
    param("userId").isMongoId(),
    body("status").isIn(["active", "suspended", "banned"]),
    body("reason").optional().trim().isLength({ max: 500 }),
    body("duration").optional().isInt({ min: 1, max: 365 }), // days
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { userId } = req.params;
      const { status, reason, duration } = req.body;
      const adminId = req.user.userId;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const previousStatus = user.status;

      user.status = status;
      user.statusReason = reason;

      if (status === "suspended" && duration) {
        user.suspendedUntil = new Date(
          Date.now() + duration * 24 * 60 * 60 * 1000,
        );
      } else {
        user.suspendedUntil = null;
      }

      await user.save();

      await logAdminAction({
        adminId,
        action: "UPDATE_USER_STATUS",
        targetUserId: userId,
        details: {
          previousStatus,
          newStatus: status,
          reason,
          duration,
        },
      });

      res.json({
        success: true,
        message: `User status updated to ${status}`,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get user details for admin
router.get(
  "/users/:userId",
  authMiddleware,
  requireRole(["admin"]),
  [param("userId").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID",
        });
      }

      const { userId } = req.params;

      const user = await User.findById(userId).lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // `documents` was never a schema path or virtual, so the old populate
      // was a silent no-op. Query them directly instead.
      const [documents, wallet, userStats] = await Promise.all([
        Document.find({ userId })
          .select(
            "generatedTitle fileType status viewsCount downloadsCount createdAt",
          )
          .sort({ createdAt: -1 })
          .limit(10)
          .lean(),
        UserWallet.findOne({ userId }).lean(),
        getUserStats(userId, user),
      ]);

      res.json({
        success: true,
        data: {
          user: {
            ...user,
            documents,
            walletBalance: wallet?.balance || 0,
            kycStatus: wallet?.kycStatus || "unverified",
          },
          stats: userStats,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Content management
router.get(
  "/documents",
  authMiddleware,
  requireRole(["admin", "moderator"]),
  [
    query("page").optional().isInt({ min: 1, max: 1000 }).default(1),
    query("limit").optional().isInt({ min: 1, max: 100 }).default(50),
    query("status")
      .optional()
      .isIn([
        "uploaded",
        "processing",
        "processed",
        "failed",
        "rejected",
        "taken_down",
        "duplicate",
        "quarantined",
        "deleted",
      ]),
    query("userId").optional().isMongoId(),
    query("search").optional().trim().isLength({ max: 100 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { page, limit, status, userId, search } = req.query;
      const skip = (page - 1) * limit;

      const query = {};
      if (status) query.status = status;
      if (userId) query.userId = userId;

      if (search) {
        const safeSearch = escapeRegex(search);
        query.$or = [
          { generatedTitle: { $regex: safeSearch, $options: "i" } },
          { originalFilename: { $regex: safeSearch, $options: "i" } },
          { generatedDescription: { $regex: safeSearch, $options: "i" } },
        ];
      }

      const [documents, total] = await Promise.all([
        Document.find(query)
          // embedding is a large float array and is never rendered.
          .select("-embedding -metadata")
          .populate("userId", "name email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Document.countDocuments(query),
      ]);

      // Thumbnails are S3 keys; the admin table needs viewable URLs.
      await Promise.all(
        documents.map(async (doc) => {
          if (doc.thumbnailS3Path) {
            doc.thumbnailUrl = await s3
              .generateViewUrl(doc.thumbnailS3Path)
              .catch(() => null);
          }
        }),
      );

      res.json({
        success: true,
        data: {
          documents,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            hasMore: skip + documents.length < total,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// --- AI configuration -----------------------------------------------------

// Current selection, plus the live model list from each vendor so the UI never
// offers a model that has been retired.
router.get(
  "/ai/settings",
  authMiddleware,
  requireRole(["admin"]),
  async (req, res, next) => {
    try {
      const [settings, catalog] = await Promise.all([
        getAiSettings(),
        listAllModels(),
      ]);

      res.json({
        success: true,
        data: {
          ...settings,
          catalog,
          // Which keys exist, never the keys themselves.
          credentials: {
            gemini: Boolean(process.env.GEMINI_API_KEY),
            groq: Boolean(process.env.GROQ_API_KEY),
            huggingface: Boolean(process.env.HUGGINGFACE_TOKEN),
            ollama: true,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/ai/settings",
  authMiddleware,
  requireRole(["admin"]),
  [
    body("providers").optional().isArray(),
    body("providers.*.provider").optional().isIn(AI_PROVIDERS),
    body("providers.*.model").optional().trim().isLength({ min: 1, max: 200 }),
    body("providers.*.enabled").optional().isBoolean(),
    body("embeddingModel").optional().trim().isLength({ min: 1, max: 200 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { providers, embeddingModel } = req.body;

      // Disabling everything would silently drop the pipeline back to local
      // heuristics, which is the failure mode this whole page exists to expose.
      if (providers && !providers.some((entry) => entry.enabled !== false)) {
        return res.status(400).json({
          success: false,
          message:
            "At least one provider must stay enabled, otherwise titles fall back to local heuristics.",
        });
      }

      const settings = await updateAiSettings({
        providers,
        embeddingModel,
        updatedBy: req.user.userId,
      });

      await logAdminAction({
        adminId: req.user.userId,
        action: "UPDATE_AI_SETTINGS",
        details: {
          providers: settings.providers.map((p) => ({
            provider: p.provider,
            model: p.model,
            enabled: p.enabled,
          })),
          embeddingModel: settings.embeddingModel,
        },
      });

      res.json({ success: true, message: "AI settings saved", data: settings });
    } catch (error) {
      next(error);
    }
  },
);

// Probe one provider with a specific model, without saving it first.
router.post(
  "/ai/test",
  authMiddleware,
  requireRole(["admin"]),
  [
    body("provider").isIn([...AI_PROVIDERS, "embedding"]),
    body("model").optional().trim().isLength({ min: 1, max: 200 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid provider or model" });
      }

      const { provider, model } = req.body;

      const result =
        provider === "embedding"
          ? await testEmbeddingModel(model)
          : await testMetadataProvider(provider, model);

      res.json({ success: true, data: { provider, model, ...result } });
    } catch (error) {
      next(error);
    }
  },
);

// Probe every enabled provider at once - the same check migration 004 runs.
router.post(
  "/ai/test-all",
  authMiddleware,
  requireRole(["admin"]),
  async (req, res, next) => {
    try {
      const [metadata, embedding] = await Promise.all([
        checkMetadataProviders({ onlyEnabled: false }),
        testEmbeddingModel(),
      ]);

      res.json({
        success: true,
        data: { ...metadata, embedding },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Everything known about one document, in one request.
router.get(
  "/documents/:documentId",
  authMiddleware,
  requireRole(["admin", "moderator"]),
  [
    param("documentId").isMongoId(),
    query("days").optional().isInt({ min: 1, max: 365 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid parameters",
          errors: errors.array(),
        });
      }

      const { documentId } = req.params;
      const days = parseInt(req.query.days, 10) || 30;

      const document = await Document.findById(documentId)
        .select("-embedding")
        .populate("userId", "name email avatar role status createdAt")
        .lean();

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      const [
        stats,
        saveCount,
        collectionCount,
        reports,
        reportCounts,
        earnings,
        thumbnailUrl,
        ownerDocumentCount,
      ] = await Promise.all([
        // Real daily series from the rollups, plus lifetime totals including
        // anything still buffered in Redis.
        getDocumentViewStats(documentId, String(days)),
        SavedDocument.countDocuments({ documentId }),
        SavedDocument.countDocuments({
          documentId,
          collectionId: { $ne: null },
        }),
        Report.find({ documentId })
          .select("type status reason severity createdAt reporterId")
          .populate("reporterId", "name email")
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
        Report.aggregate([
          { $match: { documentId: new mongoose.Types.ObjectId(documentId) } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Earnings.aggregate([
          { $match: { documentId: new mongoose.Types.ObjectId(documentId) } },
          {
            $group: {
              _id: "$type",
              total: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ]),
        document.thumbnailS3Path
          ? s3.generateViewUrl(document.thumbnailS3Path).catch(() => null)
          : Promise.resolve(null),
        Document.countDocuments({ userId: document.userId?._id }),
      ]);

      // Processing timeline, assembled from the timestamps the pipeline writes.
      const timeline = [
        { step: "uploaded", at: document.createdAt },
        { step: "processing_started", at: document.processingStartedAt || null },
        { step: "processed", at: document.processedAt || null },
      ].filter((entry) => entry.at);

      const processingDurationMs =
        document.processingStartedAt && document.processedAt
          ? new Date(document.processedAt) -
            new Date(document.processingStartedAt)
          : null;

      res.json({
        success: true,
        data: {
          document: { ...document, thumbnailUrl },
          owner: document.userId
            ? { ...document.userId, documentCount: ownerDocumentCount }
            : null,
          engagement: {
            views: stats?.totalViews ?? document.viewsCount ?? 0,
            downloads: stats?.totalDownloads ?? document.downloadsCount ?? 0,
            saves: saveCount,
            savesInCollections: collectionCount,
            viewsInPeriod: stats?.viewsInPeriod ?? 0,
            downloadsInPeriod: stats?.downloadsInPeriod ?? 0,
            series: stats?.viewsByDay ?? [],
            days,
          },
          processing: {
            status: document.status,
            error: document.processingError || null,
            retryCount: document.retryCount || 0,
            virusScan: document.virusScanResult || null,
            timeline,
            durationMs: processingDurationMs,
          },
          moderation: {
            reports,
            countsByStatus: reportCounts.reduce(
              (acc, row) => ({ ...acc, [row._id]: row.count }),
              {},
            ),
            total: reportCounts.reduce((sum, row) => sum + row.count, 0),
          },
          earnings: {
            byType: earnings,
            total: earnings.reduce((sum, row) => sum + row.total, 0),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Requeue processing for a document from the admin panel.
router.post(
  "/documents/:documentId/reprocess",
  authMiddleware,
  requireRole(["admin"]),
  [param("documentId").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid document ID" });
      }

      const { documentId } = req.params;
      const document = await Document.findById(documentId);

      if (!document) {
        return res
          .status(404)
          .json({ success: false, message: "Document not found" });
      }

      if (!document.s3Path) {
        return res.status(409).json({
          success: false,
          message: "The original file is no longer available",
        });
      }

      // Admins can requeue a run that has been going too long to be alive; the
      // job-id de-duplication stops a genuinely live run from being doubled up.
      const startedAt = document.processingStartedAt || document.updatedAt;
      const stuckFor = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity;

      if (document.status === "processing" && stuckFor < 30 * 60 * 1000) {
        return res.status(409).json({
          success: false,
          message: "This document is already being processed",
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

      await logAdminAction({
        adminId: req.user.userId,
        action: "REPROCESS_DOCUMENT",
        targetDocumentId: documentId,
        details: { retryCount: document.retryCount },
      });

      res.json({
        success: true,
        message: "Document queued for reprocessing",
        data: { documentId: document._id, status: document.status },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Rebuild only the thumbnail. Unlike a reprocess this leaves the title,
// description, tags and category exactly as they are, including admin edits.
router.post(
  "/documents/:documentId/thumbnail",
  authMiddleware,
  requireRole(["admin"]),
  [param("documentId").isMongoId()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid document ID" });
      }

      const key = await regenerateThumbnail(req.params.documentId);
      const thumbnailUrl = await s3.generateViewUrl(key).catch(() => null);

      res.json({
        success: true,
        message: "Thumbnail regenerated",
        data: { thumbnailS3Path: key, thumbnailUrl },
      });
    } catch (error) {
      // Keep the detail in the log only - error.message here carries S3 keys and
      // local rasterizer paths.
      logger.error("Thumbnail regeneration failed:", error);
      res.status(502).json({
        success: false,
        message: "Could not regenerate the thumbnail",
      });
    }
  },
);

// Update document metadata (admin only)
router.patch(
  "/documents/:documentId",
  authMiddleware,
  requireRole(["admin"]),
  [
    param("documentId").isMongoId(),
    body("generatedTitle")
      .optional()
      .trim()
      .notEmpty()
      .isLength({ max: 255 })
      .withMessage("Title must not exceed 255 characters"),
    body("generatedDescription")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Description must not exceed 500 characters"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    body("tags.*")
      .optional()
      .trim()
      .isString()
      .withMessage("Each tag must be a string"),
    body("category")
      .optional()
      // Shares the schema's list so admin validation and the model cannot drift.
      .isIn(DOCUMENT_CATEGORIES)
      .withMessage("Invalid category"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { documentId } = req.params;
      const { generatedTitle, generatedDescription, tags, category } = req.body;
      const adminId = req.user.userId;

      const document = await Document.findById(documentId);
      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      // Build update object with only provided fields
      const updateData = {};
      if (generatedTitle !== undefined) {
        updateData.generatedTitle = generatedTitle;
      }
      if (generatedDescription !== undefined) {
        updateData.generatedDescription = generatedDescription;
      }
      if (tags !== undefined) {
        // Normalize tags: trim, lowercase
        updateData.tags = tags
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0);
      }
      if (category !== undefined) {
        updateData.category = category;
      }

      // Update document
      const updatedDocument = await Document.findByIdAndUpdate(
        documentId,
        { $set: updateData },
        { new: true, runValidators: true },
      ).populate("userId", "name email");

      // Log admin action
      await logAdminAction({
        adminId,
        action: "UPDATE_DOCUMENT_METADATA",
        targetDocumentId: documentId,
        details: {
          updatedFields: Object.keys(updateData),
          updates: updateData,
        },
      });

      res.json({
        success: true,
        message: "Document updated successfully",
        data: {
          document: updatedDocument,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// System health and monitoring
router.get(
  "/system/health",
  authMiddleware,
  requireRole(["admin"]),
  async (req, res, next) => {
    try {
      const health = await getSystemHealth();

      res.json({
        success: true,
        data: health,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Payout management
router.get(
  "/payouts/overview",
  authMiddleware,
  requireRole(["admin"]),
  [
    query("timeframe")
      .optional()
      .isIn(["today", "week", "month", "year"])
      .default("month"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { timeframe } = req.query;

      const payoutStats = await getPayoutOverview(timeframe);

      res.json({
        success: true,
        data: payoutStats,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Helper functions
async function getUserStats(userId, user = null) {
  const [documentTotals, totalEarnings] =
    await Promise.all([
      // One pass over the {userId, createdAt} index instead of three.
      Document.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            documentsCount: { $sum: 1 },
            totalViews: { $sum: "$viewsCount" },
            totalDownloads: { $sum: "$downloadsCount" },
          },
        },
      ]),
      Payouts.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            status: { $in: ["completed", "processing"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

  const totals = documentTotals[0];

  return {
    documentsCount: totals?.documentsCount || 0,
    totalViews: totals?.totalViews || 0,
    totalDownloads: totals?.totalDownloads || 0,
    totalEarnings: totalEarnings[0]?.total || 0,
    joined: user
      ? user.createdAt
      : (await User.findById(userId).select("createdAt").lean())?.createdAt,
  };
}

async function getSystemHealth() {
  // Four unfiltered collection scans ran on every dashboard poll. They are
  // headline tiles, so a minute of staleness is invisible.
  const [userCount, documentCount, pendingModeration, failedProcesses] =
    await Promise.all([
      cachedCount("admin:users", 60, () => User.countDocuments()),
      cachedCount("admin:documents", 60, () => Document.countDocuments()),
      cachedCount("admin:reports:pending", 60, () =>
        Report.countDocuments({ status: "pending" }),
      ),
      cachedCount("admin:documents:failed", 60, () =>
        Document.countDocuments({ status: "failed" }),
      ),
    ]);

  const dbStatus =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";

  let redisStatus = "disconnected";
  const redisClient = databaseManager.getRedisClient();
  if (redisClient) {
    try {
      await redisClient.ping();
      redisStatus = "connected";
    } catch (error) {
      redisStatus = "error";
    }
  }

  return {
    database: dbStatus,
    redis: redisStatus,
    uptime: process.uptime(),
    metrics: {
      totalUsers: userCount,
      totalDocuments: documentCount,
      pendingModeration,
      failedProcesses,
    },
    timestamp: new Date(),
  };
}

async function getPayoutOverview(timeframe) {
  const timeFilter = getTimeFilter(timeframe);

  const [totalPayouts, pendingPayouts, completedPayouts, payoutStats] =
    await Promise.all([
      Payouts.aggregate([
        { $match: { createdAt: timeFilter } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Payouts.countDocuments({ status: "pending", createdAt: timeFilter }),
      Payouts.countDocuments({ status: "completed", createdAt: timeFilter }),
      Payouts.aggregate([
        { $match: { createdAt: timeFilter } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            totalAmount: { $sum: "$amount" },
          },
        },
      ]),
    ]);

  return {
    totalAmount: totalPayouts[0]?.total || 0,
    pendingCount: pendingPayouts,
    completedCount: completedPayouts,
    breakdown: payoutStats,
    timeframe,
  };
}

function getTimeFilter(timeframe) {
  const now = new Date();
  let startDate;

  switch (timeframe) {
    case "today":
      startDate = new Date(now.setHours(0, 0, 0, 0));
      break;
    case "week":
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case "month":
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case "year":
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    default:
      startDate = new Date(now.setMonth(now.getMonth() - 1));
  }

  return { $gte: startDate };
}

async function logAdminAction(actionData) {
  try {
    // In production, this would log to a dedicated admin actions collection
    logger.info("Admin action:", actionData);
  } catch (error) {
    logger.error("Error logging admin action:", error);
  }
}

export default router;
