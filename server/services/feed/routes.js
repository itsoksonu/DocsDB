import express from "express";
import { query, validationResult } from "express-validator";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import Document from "../../shared/models/Document.js";
import databaseManager from "../../shared/database/connection.js";
import { generateFeed } from "../../shared/utils/feedGenerator.js";
import logger from "../../shared/utils/logger.js";
import s3 from "../../shared/utils/s3.js";
import UserInteraction from "../../shared/models/UserInteraction.js";
import { body } from "express-validator";
import { GoogleGenAI } from "@google/genai";

const router = express.Router();

const redisClient = databaseManager.getRedisClient();
const geminiAI = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

// Input validation for feed queries
const feedValidation = [
  query("cursor").optional().isAlphanumeric(),
  query("limit").optional().isInt({ min: 1, max: 50 }).default(20),
  query("category")
    .optional()
    .isIn([
      "technology",
      "business",
      "education",
      "health",
      "entertainment",
      "sports",
      "finance-money-management",
      "games-activities",
      "comics",
      "philosophy",
      "career-growth",
      "politics",
      "biography-memoir",
      "study-aids-test-prep",
      "law",
      "art",
      "science",
      "history",
      "erotica",
      "lifestyle",
      "religion-spirituality",
      "self-improvement",
      "language-arts",
      "cooking-food-wine",
      "true-crime",
      "sheet-music",
      "fiction",
      "non-fiction",
      "science-fiction",
      "fantasy",
      "romance",
      "thriller-suspense",
      "horror",
      "poetry",
      "graphic-novels",
      "young-adult",
      "children",
      "parenting-family",
      "marketing-sales",
      "psychology",
      "social-sciences",
      "engineering",
      "mathematics",
      "data-science",
      "nature-environment",
      "travel",
      "reference",
      "design",
      "news-media",
      "professional-development",
      "other",
    ]),
  query("sort")
    .optional()
    .isIn(["newest", "popular", "relevant"])
    .default("newest"),
];

// Helper function to add signed thumbnails
async function addSignedThumbnails(documents) {
  if (!documents || documents.length === 0) return documents;

  return await Promise.all(
    documents.map(async (doc) => {
      doc = doc.toObject ? doc.toObject() : doc;

      if (doc.thumbnailS3Path) {
        doc.thumbnailUrl = await s3.generateViewUrl(doc.thumbnailS3Path);
      }

      // Also sign the user avatar if it exists and looks like an S3 key (not http)
      if (
        doc.userId &&
        doc.userId.avatar &&
        !doc.userId.avatar.startsWith("http")
      ) {
        doc.userId.avatar = await s3.generateViewUrl(doc.userId.avatar);
      }

      return doc;
    }),
  );
}

// Get all document IDs for sitemap
router.get("/sitemap-ids", async (req, res, next) => {
  try {
    const cacheKey = "sitemap:ids";

    if (redisClient) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json({
          success: true,
          data: JSON.parse(cached),
        });
      }
    }

    const documents = await Document.find({
      status: "processed",
      visibility: "public",
    })
      .select("_id updatedAt")
      .lean();

    const result = documents.map((doc) => ({
      _id: doc._id,
      updatedAt: doc.updatedAt,
    }));

    if (redisClient) {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result)); // Cache for 1 hour
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// get documents
router.get(
  "/",
  rateLimitMiddleware("search"),
  optionalAuthMiddleware,
  feedValidation,
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

      const { cursor, limit, category, sort } = req.query;

      const userId = req.user?.userId || "public";

      const cacheKey = `feed:${userId}:${category || "all"}:${sort}:${
        cursor || "initial"
      }:${limit}`;

      if (redisClient) {
        const cachedFeed = await redisClient.get(cacheKey);
        if (cachedFeed) {
          logger.debug(`Cache hit for feed: ${cacheKey}`);
          return res.json({
            success: true,
            data: JSON.parse(cachedFeed),
          });
        }
      }

      const feedData = await generateFeed({
        userId,
        cursor,
        limit: parseInt(limit),
        category,
        sort,
        includeAds: false,
      });

      if (feedData.documents?.length > 0) {
        feedData.documents = await addSignedThumbnails(feedData.documents);
      }

      if (redisClient && feedData.documents.length > 0) {
        await redisClient.setEx(cacheKey, 300, JSON.stringify(feedData)); // 5 minutes TTL
      }

      res.json({
        success: true,
        data: feedData,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Search documents
router.get(
  "/search",
  rateLimitMiddleware("search"),
  optionalAuthMiddleware,
  [
    query("q").trim().notEmpty().isLength({ min: 1, max: 100 }),
    query("type").optional().isIn(["semantic", "keyword"]).default("keyword"),
    query("category")
      .optional()
      .isIn([
        "technology",
        "business",
        "education",
        "health",
        "entertainment",
        "sports",
        "finance-money-management",
        "games-activities",
        "comics",
        "philosophy",
        "career-growth",
        "politics",
        "biography-memoir",
        "study-aids-test-prep",
        "law",
        "art",
        "science",
        "history",
        "erotica",
        "lifestyle",
        "religion-spirituality",
        "self-improvement",
        "language-arts",
        "cooking-food-wine",
        "true-crime",
        "sheet-music",
        "fiction",
        "non-fiction",
        "science-fiction",
        "fantasy",
        "romance",
        "thriller-suspense",
        "horror",
        "poetry",
        "graphic-novels",
        "young-adult",
        "children",
        "parenting-family",
        "marketing-sales",
        "psychology",
        "social-sciences",
        "engineering",
        "mathematics",
        "data-science",
        "nature-environment",
        "travel",
        "reference",
        "design",
        "news-media",
        "professional-development",
        "other",
      ]),
    query("page").optional().isInt({ min: 1 }).default(1),
    query("limit").optional().isInt({ min: 1, max: 50 }).default(20),
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

      const { q, type, category, page, limit } = req.query;
      const userId = req.user?.userId || "public";

      const cacheKey = `search:${q}:${type}:${
        category || "all"
      }:${page}:${limit}`;

      if (redisClient) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          logger.debug(`Cache hit for search: ${cacheKey}`);
          return res.json({
            success: true,
            data: JSON.parse(cached),
          });
        }
      }

      const searchResults = await performSearch({
        query: q,
        type,
        category,
        page: parseInt(page),
        limit: parseInt(limit),
        userId,
      });

      if (searchResults.documents?.length > 0) {
        searchResults.documents = await addSignedThumbnails(
          searchResults.documents,
        );
      }

      if (redisClient && searchResults.documents.length > 0) {
        await redisClient.setEx(cacheKey, 600, JSON.stringify(searchResults));
      }

      res.json({
        success: true,
        data: searchResults,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get related documents
router.get(
  "/related/:documentId",
  optionalAuthMiddleware,
  [query("limit").optional().isInt({ min: 1, max: 20 }).default(10)],
  async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const { limit } = req.query;

      const relatedDocs = await getRelatedDocuments(
        documentId,
        parseInt(limit),
      );

      const docsWithThumbnails = await addSignedThumbnails(relatedDocs);

      res.json({
        success: true,
        data: docsWithThumbnails,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get trending documents
router.get(
  "/trending",
  optionalAuthMiddleware,
  [
    query("timeframe")
      .optional()
      .isIn(["today", "week", "month"])
      .default("week"),
    query("limit").optional().isInt({ min: 1, max: 50 }).default(20),
  ],
  async (req, res, next) => {
    try {
      const { timeframe, limit } = req.query;
      const cacheKey = `trending:${timeframe}:${limit}`;

      if (redisClient) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return res.json({
            success: true,
            data: JSON.parse(cached),
          });
        }
      }

      let trendingDocs = await getTrendingDocuments(timeframe, parseInt(limit));

      // Fallback: If we don't have enough trending documents, fill with all-time popular docs
      if (trendingDocs.length < parseInt(limit)) {
        const remaining = parseInt(limit) - trendingDocs.length;
        const existingIds = trendingDocs.map((doc) => doc._id);

        const fallbackDocs = await Document.find({
          status: "processed",
          visibility: "public",
          _id: { $nin: existingIds },
        })
          .select("-metadata -embeddingsId")
          .populate("userId", "name avatar")
          .sort({ viewsCount: -1 }) // All-time popular
          .limit(remaining)
          .lean(); // Use lean to get POJOs similar to optimization in getTrendingDocuments

        // Normalize fallback docs to match aggregation result structure if needed,
        // but addSignedThumbnails handles both mongoose docs and POJOs.
        // We just need to make sure the structure is compatible for the frontend.
        // The aggregation returns flattened user fields in some cases, or lookup.
        // Let's ensure consistency. getTrendingDocuments returns aggregate result.
        // Document.find returns Mongoose documents.

        // We'll map fallbackDocs to match the structure if necessary, or just rely on frontend handling both.
        // Frontend expects: _id, generatedTitle, user: { name, avatar } etc.
        // Mongoose populate gives user object properly.

        trendingDocs = [...trendingDocs, ...fallbackDocs];
      }

      const docsWithThumbnails = await addSignedThumbnails(trendingDocs);

      if (redisClient) {
        await redisClient.setEx(
          cacheKey,
          900,
          JSON.stringify(docsWithThumbnails),
        );
      }

      res.json({
        success: true,
        data: docsWithThumbnails,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get categories with counts
router.get("/categories", async (req, res, next) => {
  try {
    const cacheKey = "categories:counts";

    if (redisClient) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json({
          success: true,
          data: JSON.parse(cached),
        });
      }
    }

    const categories = await getCategoryCounts();

    if (redisClient) {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(categories));
    }

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
});

// Get personalized feed
router.get(
  "/personalized",
  authMiddleware,
  rateLimitMiddleware("search"),
  feedValidation,
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

      const { cursor, limit, category, sort } = req.query;
      const userId = req.user.userId;

      const cacheKey = `feed:personalized:${userId}:${
        category || "all"
      }:${sort}:${cursor || "initial"}:${limit}`;

      if (redisClient) {
        const cachedFeed = await redisClient.get(cacheKey);
        if (cachedFeed) {
          logger.debug(`Cache hit for personalized feed: ${cacheKey}`);
          return res.json({
            success: true,
            data: JSON.parse(cachedFeed),
          });
        }
      }

      const feedData = await generateFeed({
        userId,
        cursor,
        limit: parseInt(limit),
        category,
        sort,
        includeAds: true,
        personalized: true,
      });

      if (feedData.documents?.length > 0) {
        feedData.documents = await addSignedThumbnails(feedData.documents);
      }

      if (redisClient && feedData.documents.length > 0) {
        await redisClient.setEx(cacheKey, 180, JSON.stringify(feedData));
      }

      res.json({
        success: true,
        data: feedData,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Record user interaction (Don't show again / Show more like this)
router.post(
  "/interactions",
  authMiddleware,
  rateLimitMiddleware("write"),
  [
    body("documentId").isMongoId(),
    body("type").isIn(["hidden", "more_like_this"]),
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

      const { documentId, type } = req.body;
      const userId = req.user.userId;

      // Upsert the interaction
      await UserInteraction.findOneAndUpdate(
        { userId, documentId, type },
        { userId, documentId, type },
        { upsert: true, new: true },
      );

      // Invalidate relevant redis caches
      if (redisClient) {
        // Clear specific feed caches for this user
        const feedPattern = `feed:${userId}:*`;
        const personalizedFeedPattern = `feed:personalized:${userId}:*`;

        // Note: Redis generic SCAN/DELETE for patterns is expensive in prod,
        // but for specific user keys it's acceptable or we can just let them expire.
        // A better approach is to rely on short TTLs or specific keys if known.
        // Here we'll just log it for now as a production optimization todo.
        // Alternatively, if we know exact keys we can del them.

        // For now, we rely on the feed generator to filter out 'hidden' items dynamically
        // even if the list is cached, or we can force cache bypass on client side.
        // BUT, since we store the *generated* feed in cache, we MUST invalidate it
        // if we want immediate effect without waiting 5 mins.

        // Simple strategy: Clear the most likely keys or just wait for TTL.

        const keys = await redisClient.keys(`feed:*${userId}*`);
        if (keys.length > 0) {
          await redisClient.del(keys);
        }
      }

      res.json({
        success: true,
        message: "Interaction recorded",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Helper functions
async function performSearch({ query, type, category, page, limit, userId }) {
  const skip = (page - 1) * limit;

  let searchQuery = {
    status: "processed",
    visibility: "public",
  };

  if (category) {
    searchQuery.category = category;
  }

  if (type === "semantic") {
    try {
      if (!geminiAI)
        throw new Error("Gemini not configured for semantic search");

      const embeddingResult = await geminiAI.models.embedContent({
        model: "text-embedding-004",
        contents: [
          {
            parts: [{ text: query }],
          },
        ],
      });
      const queryVector = embeddingResult.embeddings?.[0]?.values;

      if (!queryVector) throw new Error("Failed to generate query embedding");

      const pipeline = [
        {
          $vectorSearch: {
            index: "gemini-embedding", // User must create this in Atlas
            path: "embedding",
            queryVector: queryVector,
            numCandidates: 100,
            limit: limit * 2, // Check more for filtering
          },
        },
        {
          $match: {
            status: "processed",
            visibility: "public",
            ...(category ? { category } : {}),
          },
        },
        {
          $project: {
            embedding: 0,
            score: { $meta: "vectorSearchScore" },
          },
        },
        { $limit: limit },
      ];

      const documents = await Document.aggregate(pipeline);

      // Manually populate userId since aggregate doesn't do it automatically like find()
      await Document.populate(documents, {
        path: "userId",
        select: "name avatar",
      });

      return {
        documents: documents.map((doc) => ({ ...doc, id: doc._id })), // Normalize ID
        pagination: {
          page,
          limit,
          total: documents.length, // Approximate for vector search
          hasMore: false, // Vector search usually top-k
        },
        query,
        type: "semantic",
      };
    } catch (error) {
      logger.error("Semantic search failed, falling back to keyword:", error);
      // Fallback to keyword search
      return performSearch({
        query,
        type: "keyword",
        category,
        page,
        limit,
        userId,
      });
    }
  } else {
    // Keyword search using MongoDB Text Index
    searchQuery.$text = { $search: query };

    const [documents, total] = await Promise.all([
      Document.find(searchQuery)
        .select("-metadata -embeddingsId -embedding")
        .populate("userId", "name avatar")
        .sort({ score: { $meta: "textScore" } })
        .skip(skip)
        .limit(limit),
      Document.countDocuments(searchQuery),
    ]);

    return {
      documents,
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + documents.length < total,
      },
      query,
      type,
    };
  }
}

async function getRelatedDocuments(documentId, limit) {
  const document = await Document.findById(documentId);
  if (!document) {
    return [];
  }

  const relatedDocs = await Document.find({
    _id: { $ne: documentId },
    status: "processed",
    visibility: "public",
    $or: [
      { category: document.category },
      { tags: { $in: document.tags.slice(0, 3) } },
    ],
  })
    .select("-metadata -embeddingsId")
    .populate("userId", "name avatar")
    .sort({ viewsCount: -1, createdAt: -1 })
    .limit(limit);

  return relatedDocs;
}

async function getTrendingDocuments(timeframe, limit) {
  const timeFilter = getTimeFilter(timeframe);

  const trendingDocs = await Document.aggregate([
    {
      $match: {
        status: "processed",
        visibility: "public",
        createdAt: timeFilter,
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "userId", // Overwrite userId with populated data
      },
    },
    {
      $unwind: "$userId",
    },
    {
      $project: {
        _id: 1,
        generatedTitle: 1,
        generatedDescription: 1,
        thumbnailS3Path: 1,
        fileType: 1,
        viewsCount: 1,
        downloadsCount: 1,
        tags: 1,
        category: 1,
        createdAt: 1,
        "userId.name": 1,
        "userId.avatar": 1,
        "userId._id": 1,
        trendingScore: {
          $add: [
            { $multiply: ["$viewsCount", 1] },
            { $multiply: ["$downloadsCount", 5] },
          ],
        },
      },
    },
    {
      $sort: { trendingScore: -1, createdAt: -1 },
    },
    {
      $limit: limit,
    },
  ]);

  return trendingDocs;
}

async function getCategoryCounts() {
  const counts = await Document.aggregate([
    {
      $match: {
        status: "processed",
        visibility: "public",
      },
    },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);

  return counts;
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
    default:
      startDate = new Date(now.setDate(now.getDate() - 7));
  }

  return { $gte: startDate };
}

export default router;
