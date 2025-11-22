import express from "express";
import { param, query, validationResult } from "express-validator";
import mongoose from "mongoose";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import Document from "../../shared/models/Document.js";
import { trackView } from "../../shared/utils/analytics.js";
import databaseManager from "../../shared/database/connection.js";
import S3Manager from "../../shared/utils/s3.js";
import s3 from "../../shared/utils/s3.js";
import logger from "../../shared/utils/logger.js";

const router = express.Router();

const redisClient = databaseManager.getRedisClient();

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
    })
  );
}

// Get document by ID
router.get(
  "/:id",
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

      const document = await Document.findById(id).populate("userId", "name");

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
  }
);

// Get document content for viewing
router.get(
  "/:id/view",
  optionalAuthMiddleware,
  [param("id").isMongoId(), query("page").optional().isInt({ min: 1 })],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid parameters",
        });
      }

      const { id } = req.params;
      const { page } = req.query;
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
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this document",
        });
      }

      let viewUrl;
      try {
        viewUrl = await s3.generateViewUrl(document.s3Path);

        if (!viewUrl) {
          viewUrl = await S3Manager.generateDownloadUrl(
            document.s3Path,
            document.originalFilename,
            3600
          );
        }
      } catch (error) {
        logger.error("Error generating view URL:", error);
        viewUrl = document.s3Path
          ? `https://your-bucket.s3.amazonaws.com/${document.s3Path}`
          : null;
      }

      const viewerData = await getViewerData(document, page);

      res.json({
        success: true,
        data: {
          document: {
            id: document._id,
            title: document.generatedTitle,
            fileType: document.fileType,
            pageCount: document.pageCount,
          },
          viewUrl: viewUrl || null,
          viewerData,
          expiresIn: 3600,
        },
      });
    } catch (error) {
      logger.error("Error in document view endpoint:", error);
      next(error);
    }
  }
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
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid parameters" });
      }

      const { cursor, limit, status } = req.query;
      const userId = req.user.userId;

      const cacheKey = `mydocs:${userId}:${status}:${
        cursor || "initial"
      }:${limit}`;

      if (redisClient) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return res.json({ success: true, data: JSON.parse(cached) });
        }
      }

      let query = { userId, status: "processed" };

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

      if (redisClient && docs.length > 0) {
        await redisClient.setEx(cacheKey, 120, JSON.stringify(response));
      }

      res.json({ success: true, data: response });
    } catch (error) {
      next(error);
    }
  }
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
        { new: true, runValidators: true }
      ).select("-metadata -embeddingsId");

      res.json({
        success: true,
        message: "Document updated successfully",
        data: { document: updatedDocument },
      });
    } catch (error) {
      next(error);
    }
  }
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

      document.status = "deleted";
      await document.save();

      // In production, might want to actually delete from S3
      // await S3Manager.deleteObject(document.s3Path);

      res.json({
        success: true,
        message: "Document deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }
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
  }
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

    if (redisClient) {
      const cached = await redisClient.get(cacheKey);
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

    if (redisClient) {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(analytics));
    }

    return analytics;
  } catch (error) {
    logger.error("Error getting document analytics:", error);
    return {};
  }
}

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

      const User = mongoose.model("User");
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const document = await Document.findById(id);
      if (!document || !document.isViewable()) {
        return res.status(404).json({
          success: false,
          message: "Document not found or not accessible",
        });
      }

      await user.saveDocument(id);

      res.json({
        success: true,
        message: "Document saved successfully",
      });
    } catch (error) {
      next(error);
    }
  }
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

      const User = mongoose.model("User");
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      await user.unsaveDocument(id);

      res.json({
        success: true,
        message: "Document unsaved successfully",
      });
    } catch (error) {
      next(error);
    }
  }
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

      const User = mongoose.model("User");
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const isSaved = user.hasSavedDocument(id);

      res.json({
        success: true,
        data: { isSaved },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get user's saved documents
router.get(
  "/user/saved-documents",
  authMiddleware,
  [
    query("cursor").optional().isString(),
    query("limit").optional().isInt({ min: 1, max: 50 }).default(20),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid parameters" });
      }

      const { cursor, limit } = req.query;
      const userId = req.user.userId;

      const cacheKey = `saveddocs:${userId}:${cursor || "initial"}:${limit}`;

      if (redisClient) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return res.json({ success: true, data: JSON.parse(cached) });
        }
      }

      const User = mongoose.model("User");
      const user = await User.findById(userId).populate({
        path: "savedDocuments.documentId",
        match: { status: "processed", visibility: "public" },
        populate: { path: "userId", select: "name" },
      });

      const valid = user.savedDocuments.filter((d) => d.documentId !== null);

      const sorted = valid
        .sort((a, b) => b.savedAt - a.savedAt)
        .map((item) => ({
          savedAt: item.savedAt,
          ...item.documentId.toObject(),
        }));

      let startIndex = 0;
      if (cursor) {
        startIndex = sorted.findIndex((x) => x._id.toString() === cursor) + 1;
      }

      const sliced = sorted.slice(startIndex, startIndex + parseInt(limit));
      const hasMore = sorted.length > startIndex + sliced.length;

      const docsWithThumb = await addSignedThumbnails(sliced);

      const response = {
        documents: docsWithThumb,
        cursor: cursor || null,
        nextCursor: hasMore ? sliced[sliced.length - 1]._id : null,
      };

      if (redisClient && sliced.length > 0) {
        await redisClient.setEx(cacheKey, 180, JSON.stringify(response));
      }

      res.json({ success: true, data: response });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
