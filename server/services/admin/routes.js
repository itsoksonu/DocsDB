import express from 'express';
import { param, query, body, validationResult } from 'express-validator';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';
import User from '../../shared/models/User.js';
import Document from '../../shared/models/Document.js';
import Payouts from '../../shared/models/Payouts.js';
import Report from '../../shared/models/Report.js';
import { 
  moderateContent,
  processReport,
  generateAdminStats,
  takeDownDocument,
  restoreDocument
} from '../../shared/utils/moderationEngine.js';
import logger from '../../shared/utils/logger.js';

const router = express.Router();

// Admin dashboard statistics
router.get('/dashboard',
  authMiddleware,
  requireRole(['admin']),
  async (req, res, next) => {
    try {
      const stats = await generateAdminStats();

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get moderation queue
router.get('/moderation/queue',
  authMiddleware,
  requireRole(['admin', 'moderator']),
  [
    query('status').optional().isIn(['pending', 'approved', 'rejected', 'escalated']).default('pending'),
    query('type').optional().isIn(['upload', 'report', 'dmca']),
    query('page').optional().isInt({ min: 1 }).default(1),
    query('limit').optional().isInt({ min: 1, max: 100 }).default(50)
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

      const { status, type, page, limit } = req.query;
      const skip = (page - 1) * limit;

      const query = { status };
      if (type) {
        query.type = type;
      }

      const [queueItems, total] = await Promise.all([
        Report.find(query)
          .populate('reporterId', 'name email')
          .populate('documentId', 'generatedTitle fileType userId')
          .populate('targetUserId', 'name email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Report.countDocuments(query)
      ]);

      res.json({
        success: true,
        data: {
          queueItems,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            hasMore: (skip + queueItems.length) < total
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Process moderation item
router.post('/moderation/:reportId/process',
  authMiddleware,
  requireRole(['admin', 'moderator']),
  [
    param('reportId').isMongoId(),
    body('action').isIn(['approve', 'reject', 'escalate', 'request_more_info']),
    body('reason').optional().trim().isLength({ max: 1000 }),
    body('severity').optional().isIn(['low', 'medium', 'high', 'critical'])
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

      const { reportId } = req.params;
      const { action, reason, severity } = req.body;
      const moderatorId = req.user.userId;

      const result = await processReport(reportId, {
        action,
        reason,
        severity,
        moderatorId
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message
        });
      }

      res.json({
        success: true,
        message: `Report ${action}ed successfully`,
        data: {
          report: result.report,
          actionsTaken: result.actionsTaken
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Take down document (immediate action)
router.post('/documents/:documentId/takedown',
  authMiddleware,
  requireRole(['admin']),
  [
    param('documentId').isMongoId(),
    body('reason').notEmpty().trim().isLength({ max: 500 }),
    body('notifyUser').optional().isBoolean().default(true)
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

      const { documentId } = req.params;
      const { reason, notifyUser } = req.body;
      const adminId = req.user.userId;

      const result = await takeDownDocument(documentId, {
        reason,
        notifyUser,
        adminId
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message
        });
      }

      res.json({
        success: true,
        message: 'Document taken down successfully',
        data: {
          document: result.document,
          notificationSent: result.notificationSent
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Restore taken down document
router.post('/documents/:documentId/restore',
  authMiddleware,
  requireRole(['admin']),
  [
    param('documentId').isMongoId(),
    body('reason').optional().trim().isLength({ max: 500 })
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

      const { documentId } = req.params;
      const { reason } = req.body;
      const adminId = req.user.userId;

      const result = await restoreDocument(documentId, {
        reason,
        adminId
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message
        });
      }

      res.json({
        success: true,
        message: 'Document restored successfully',
        data: {
          document: result.document
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// User management
router.get('/users',
  authMiddleware,
  requireRole(['admin']),
  [
    query('page').optional().isInt({ min: 1 }).default(1),
    query('limit').optional().isInt({ min: 1, max: 100 }).default(50),
    query('search').optional().trim().isLength({ max: 100 }),
    query('role').optional().isIn(['user', 'creator', 'moderator', 'admin']),
    query('status').optional().isIn(['active', 'suspended', 'banned'])
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

      const { page, limit, search, role, status } = req.query;
      const skip = (page - 1) * limit;

      const query = {};
      if (role) query.role = role;
      if (status) query.status = status;

      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      const [users, total] = await Promise.all([
        User.find(query)
          .select('-password')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        User.countDocuments(query)
      ]);

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            hasMore: (skip + users.length) < total
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Update user status
router.patch('/users/:userId/status',
  authMiddleware,
  requireRole(['admin']),
  [
    param('userId').isMongoId(),
    body('status').isIn(['active', 'suspended', 'banned']),
    body('reason').optional().trim().isLength({ max: 500 }),
    body('duration').optional().isInt({ min: 1, max: 365 }) // days
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

      const { userId } = req.params;
      const { status, reason, duration } = req.body;
      const adminId = req.user.userId;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update user status
      user.status = status;
      user.statusReason = reason;
      
      if (status === 'suspended' && duration) {
        user.suspendedUntil = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
      } else {
        user.suspendedUntil = null;
      }

      await user.save();

      // Log the action
      await logAdminAction({
        adminId,
        action: 'UPDATE_USER_STATUS',
        targetUserId: userId,
        details: {
          previousStatus: user.status,
          newStatus: status,
          reason,
          duration
        }
      });

      res.json({
        success: true,
        message: `User status updated to ${status}`,
        data: { user }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get user details for admin
router.get('/users/:userId',
  authMiddleware,
  requireRole(['admin']),
  [
    param('userId').isMongoId()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID'
        });
      }

      const { userId } = req.params;

      const user = await User.findById(userId)
        .select('-password')
        .populate({
          path: 'documents',
          select: 'generatedTitle fileType status viewsCount downloadsCount createdAt',
          options: { limit: 10, sort: { createdAt: -1 } }
        });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get additional user stats
      const userStats = await getUserStats(userId);

      res.json({
        success: true,
        data: {
          user,
          stats: userStats
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Content management
router.get('/documents',
  authMiddleware,
  requireRole(['admin', 'moderator']),
  [
    query('page').optional().isInt({ min: 1 }).default(1),
    query('limit').optional().isInt({ min: 1, max: 100 }).default(50),
    query('status').optional().isIn(['uploaded', 'processing', 'processed', 'failed', 'rejected', 'taken_down']),
    query('userId').optional().isMongoId(),
    query('search').optional().trim().isLength({ max: 100 })
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

      const { page, limit, status, userId, search } = req.query;
      const skip = (page - 1) * limit;

      const query = {};
      if (status) query.status = status;
      if (userId) query.userId = userId;

      if (search) {
        query.$or = [
          { generatedTitle: { $regex: search, $options: 'i' } },
          { originalFilename: { $regex: search, $options: 'i' } },
          { generatedDescription: { $regex: search, $options: 'i' } }
        ];
      }

      const [documents, total] = await Promise.all([
        Document.find(query)
          .populate('userId', 'name email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Document.countDocuments(query)
      ]);

      res.json({
        success: true,
        data: {
          documents,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            hasMore: (skip + documents.length) < total
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// System health and monitoring
router.get('/system/health',
  authMiddleware,
  requireRole(['admin']),
  async (req, res, next) => {
    try {
      const health = await getSystemHealth();

      res.json({
        success: true,
        data: health
      });

    } catch (error) {
      next(error);
    }
  }
);

// Payout management
router.get('/payouts/overview',
  authMiddleware,
  requireRole(['admin']),
  [
    query('timeframe').optional().isIn(['today', 'week', 'month', 'year']).default('month')
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

      const { timeframe } = req.query;

      const payoutStats = await getPayoutOverview(timeframe);

      res.json({
        success: true,
        data: payoutStats
      });

    } catch (error) {
      next(error);
    }
  }
);

// Helper functions
async function getUserStats(userId) {
  const [documentsCount, totalViews, totalDownloads, totalEarnings] = await Promise.all([
    Document.countDocuments({ userId }),
    Document.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: '$viewsCount' } } }
    ]),
    Document.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: '$downloadsCount' } } }
    ]),
    Payouts.aggregate([
      { 
        $match: { 
          userId: new mongoose.Types.ObjectId(userId),
          status: { $in: ['completed', 'processing'] }
        } 
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
  ]);

  return {
    documentsCount,
    totalViews: totalViews[0]?.total || 0,
    totalDownloads: totalDownloads[0]?.total || 0,
    totalEarnings: totalEarnings[0]?.total || 0,
    joined: (await User.findById(userId)).createdAt
  };
}

async function getSystemHealth() {
  const [userCount, documentCount, pendingModeration, failedProcesses] = await Promise.all([
    User.countDocuments(),
    Document.countDocuments(),
    Report.countDocuments({ status: 'pending' }),
    Document.countDocuments({ status: 'failed' })
  ]);

  // Check database connection
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

  // Check Redis connection
  let redisStatus = 'disconnected';
  if (redisClient) {
    try {
      await redisClient.ping();
      redisStatus = 'connected';
    } catch (error) {
      redisStatus = 'error';
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
      failedProcesses
    },
    timestamp: new Date()
  };
}

async function getPayoutOverview(timeframe) {
  const timeFilter = getTimeFilter(timeframe);

  const [totalPayouts, pendingPayouts, completedPayouts, payoutStats] = await Promise.all([
    Payouts.aggregate([
      { $match: { createdAt: timeFilter } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    Payouts.countDocuments({ status: 'pending', createdAt: timeFilter }),
    Payouts.countDocuments({ status: 'completed', createdAt: timeFilter }),
    Payouts.aggregate([
      { $match: { createdAt: timeFilter } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ])
  ]);

  return {
    totalAmount: totalPayouts[0]?.total || 0,
    pendingCount: pendingPayouts,
    completedCount: completedPayouts,
    breakdown: payoutStats,
    timeframe
  };
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
      startDate = new Date(now.setMonth(now.getMonth() - 1));
  }

  return { $gte: startDate };
}

async function logAdminAction(actionData) {
  try {
    // In production, this would log to a dedicated admin actions collection
    logger.info('Admin action:', actionData);
  } catch (error) {
    logger.error('Error logging admin action:', error);
  }
}

export default router;