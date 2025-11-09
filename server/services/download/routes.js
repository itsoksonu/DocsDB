import express from 'express';
import { param, body, query, validationResult } from 'express-validator';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';
import Document from '../../shared/models/Document.js';
import { trackDownload } from '../../shared/utils/analytics.js';
import { trackMonetizationEvent } from '../../shared/utils/monetizationEngine.js';
import S3Manager from '../../shared/utils/s3.js';
import databaseManager from '../../shared/database/connection.js';
import { 
  createDownloadSession, 
  validateDownloadRequest,
  getAdForDownload,
  completeDownloadSession 
} from '../../shared/utils/downloadManager.js';
import logger from '../../shared/utils/logger.js';

const router = express.Router();

const redisClient = databaseManager.getRedisClient();

// Request download (starts download session with ad)
router.post('/:id/request',
  authMiddleware,
  rateLimitMiddleware('download'),
  [
    param('id').isMongoId()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid document ID'
        });
      }

      const { id } = req.params;
      const userId = req.user.userId;
      const userIp = req.ip;

      // Validate download request
      const validation = await validateDownloadRequest(id, userId, userIp);
      if (!validation.valid) {
        return res.status(validation.statusCode || 400).json({
          success: false,
          message: validation.message
        });
      }

      // Create download session
      const session = await createDownloadSession({
        documentId: id,
        userId,
        userIp,
        userAgent: req.get('User-Agent')
      });

      // Get ad for download interstitial
      const ad = await getAdForDownload(userId);

      res.json({
        success: true,
        data: {
          sessionId: session.sessionId,
          adRequired: session.adRequired,
          ad: session.adRequired ? ad : null,
          timer: session.timerDuration,
          document: {
            id: validation.document._id,
            title: validation.document.generatedTitle,
            fileType: validation.document.fileType,
            size: validation.document.formattedSize
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Complete download after ad/timer
router.post('/:id/complete',
  authMiddleware,
  [
    param('id').isMongoId(),
    body('sessionId').notEmpty(),
    body('adCompleted').optional().isBoolean()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { id } = req.params;
      const { sessionId, adCompleted = false } = req.body;
      const userId = req.user.userId;

      // Complete download session and validate
      const session = await completeDownloadSession(sessionId, userId, adCompleted);
      if (!session.valid) {
        return res.status(400).json({
          success: false,
          message: session.message
        });
      }

      // Get document for download URL
      const document = await Document.findById(id);
      if (!document) {
        return res.status(404).json({
          success: false,
          message: 'Document not found'
        });
      }

      // Generate signed download URL
      const downloadUrl = S3Manager.generateDownloadUrl(
        document.s3Path,
        document.originalFilename,
        3600 // 1 hour expiry
      );

      // Track download for analytics and monetization
      const downloadTracked = await trackDownload(id, userId, req.ip);
      if (downloadTracked) {
        // Record monetization event
        await trackMonetizationEvent('download', {
          documentId: id,
          userId: document.userId, // Document owner gets earnings
          country: getCountryFromIp(req.ip),
          deviceType: getDeviceType(req.get('User-Agent'))
        });
      }

      // Log successful download
      logger.info(`Download completed for document ${id} by user ${userId}`);

      res.json({
        success: true,
        data: {
          downloadUrl,
          expiresIn: 3600,
          filename: document.originalFilename,
          document: {
            id: document._id,
            title: document.generatedTitle,
            fileType: document.fileType
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get download status and history
router.get('/history',
  authMiddleware,
  [
    query('page').optional().isInt({ min: 1 }).default(1),
    query('limit').optional().isInt({ min: 1, max: 50 }).default(20)
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { page, limit } = req.query;
      const userId = req.user.userId;

      const downloadHistory = await getDownloadHistory(userId, parseInt(page), parseInt(limit));

      res.json({
        success: true,
        data: downloadHistory
      });

    } catch (error) {
      next(error);
    }
  }
);

// Track ad view for download (called from frontend when ad is viewed)
router.post('/ad/view',
  authMiddleware,
  [
    body('sessionId').notEmpty(),
    body('adId').notEmpty()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { sessionId, adId } = req.body;
      const userId = req.user.userId;

      // Verify session belongs to user
      const sessionKey = `download:session:${sessionId}`;
      if (redisClient) {
        const sessionData = await redisClient.get(sessionKey);
        if (!sessionData) {
          return res.status(404).json({
            success: false,
            message: 'Download session not found'
          });
        }

        const session = JSON.parse(sessionData);
        if (session.userId !== userId) {
          return res.status(403).json({
            success: false,
            message: 'Session does not belong to user'
          });
        }

        // Mark ad as viewed in session
        session.adViewed = true;
        session.adViewedAt = new Date().toISOString();
        await redisClient.setEx(sessionKey, session.ttl, JSON.stringify(session));
      }

      // Track ad view for analytics
      await trackAdView(adId, userId);

      res.json({
        success: true,
        message: 'Ad view tracked successfully'
      });

    } catch (error) {
      next(error);
    }
  }
);

// Admin route: Get download statistics
router.get('/admin/statistics',
  authMiddleware,
  requireRole(['admin']),
  [
    query('timeframe').optional().isIn(['today', 'week', 'month', 'year']).default('week'),
    query('documentId').optional().isMongoId()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { timeframe, documentId } = req.query;

      const statistics = await getDownloadStatistics(timeframe, documentId);

      res.json({
        success: true,
        data: statistics
      });

    } catch (error) {
      next(error);
    }
  }
);

// Helper functions
async function getDownloadHistory(userId, page, limit) {
  const skip = (page - 1) * limit;
  
  // In production, this would query a dedicated downloads collection
  // For now, we'll use Redis or mock data
  const cacheKey = `downloads:user:${userId}:${page}:${limit}`;
  
  if (redisClient) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  // Mock download history (in production, this would be real data)
  const mockHistory = {
    downloads: [],
    pagination: {
      page,
      limit,
      total: 0,
      hasMore: false
    }
  };

  if (redisClient) {
    await redisClient.setEx(cacheKey, 300, JSON.stringify(mockHistory)); // 5 minutes cache
  }

  return mockHistory;
}

async function getDownloadStatistics(timeframe, documentId = null) {
  const timeFilter = getTimeFilter(timeframe);
  
  // Mock statistics (in production, this would aggregate from analytics)
  const stats = {
    timeframe,
    totalDownloads: Math.floor(Math.random() * 1000),
    uniqueDownloaders: Math.floor(Math.random() * 500),
    completionRate: 85 + Math.random() * 10, // 85-95%
    revenueGenerated: Math.floor(Math.random() * 1000),
    downloadsByDay: generateDailyDownloads(7),
    topDocuments: await getTopDownloadedDocuments(timeframe, 10)
  };

  if (documentId) {
    stats.documentStats = await getDocumentDownloadStats(documentId, timeframe);
  }

  return stats;
}

async function getTopDownloadedDocuments(timeframe, limit = 10) {
  const timeFilter = getTimeFilter(timeframe);
  
  // Mock top documents (in production, this would be a real aggregation)
  return [
    {
      documentId: 'mock1',
      title: 'Sample Document 1',
      downloads: 150,
      revenue: 30.00
    },
    {
      documentId: 'mock2',
      title: 'Sample Document 2',
      downloads: 120,
      revenue: 24.00
    }
  ].slice(0, limit);
}

async function getDocumentDownloadStats(documentId, timeframe) {
  // Mock document stats
  return {
    documentId,
    totalDownloads: Math.floor(Math.random() * 200),
    downloadsThisPeriod: Math.floor(Math.random() * 50),
    completionRate: 80 + Math.random() * 15,
    revenue: Math.floor(Math.random() * 40)
  };
}

function generateDailyDownloads(days) {
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    result.push({
      date: date.toISOString().split('T')[0],
      downloads: Math.floor(Math.random() * 30)
    });
  }
  return result;
}

function getTimeFilter(timeframe) {
  const now = new Date();
  let startDate;

  switch (timeframe) {
    case 'today':
      startDate = new Date(now.setHours(0, 0, 0, 0));
      break;
    case 'week':
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'year':
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    default:
      startDate = new Date(now.setDate(now.getDate() - 7));
  }

  return { $gte: startDate };
}

function getCountryFromIp(ip) {
  // Simplified - in production, use a geoIP service
  return 'US';
}

function getDeviceType(userAgent) {
  if (!userAgent) return 'desktop';
  
  if (/mobile/i.test(userAgent)) {
    return 'mobile';
  } else if (/tablet/i.test(userAgent)) {
    return 'tablet';
  } else {
    return 'desktop';
  }
}

async function trackAdView(adId, userId) {
  // Track ad view for analytics
  logger.info(`Ad view tracked: ${adId} by user ${userId}`);
  
  // In production, this would integrate with your ad analytics
  return true;
}

export default router;