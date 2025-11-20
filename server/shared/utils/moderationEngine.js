import Document from '../models/Document.js';
import User from '../models/User.js';
import Report from '../models/Report.js';
import databaseManager from '../database/connection.js';
import logger from './logger.js';

const redisClient = databaseManager.getRedisClient();

export async function moderateContent(documentId, options = {}) {
  try {
    const document = await Document.findById(documentId);
    if (!document) {
      return { success: false, message: 'Document not found' };
    }

    const { autoApprove = true, checkSensitiveContent = true } = options;

    const moderationResult = await performAIModeration(document);

    if (moderationResult.flagged && !autoApprove) {
      const report = new Report({
        documentId,
        targetUserId: document.userId,
        type: 'inappropriate',
        reason: `AI moderation flagged content: ${moderationResult.reasons.join(', ')}`,
        category: 'upload',
        priority: moderationResult.severity === 'high' ? 'high' : 'medium',
        status: 'pending',
        metadata: {
          aiConfidence: moderationResult.confidence,
          flaggedCategories: moderationResult.categories
        }
      });

      await report.save();

      document.status = 'under_review';
      await document.save();

      return {
        success: true,
        action: 'flagged',
        reportId: report._id,
        reasons: moderationResult.reasons
      };
    }

    if (autoApprove) {
      document.status = 'processed';
      await document.save();

      return {
        success: true,
        action: 'approved',
        reasons: ['Auto-approved by moderation system']
      };
    }

    return {
      success: true,
      action: 'pending_review',
      reasons: ['Pending manual review']
    };

  } catch (error) {
    logger.error('Error moderating content:', error);
    return { success: false, message: 'Moderation failed' };
  }
}

export async function processReport(reportId, options) {
  try {
    const { action, reason, severity, moderatorId } = options;

    const report = await Report.findById(reportId);
    if (!report) {
      return { success: false, message: 'Report not found' };
    }

    switch (action) {
      case 'approve':
        return await approveReport(report, { reason, moderatorId });
      
      case 'reject':
        return await rejectReport(report, { reason, moderatorId });
      
      case 'escalate':
        return await escalateReport(report, { reason, severity, moderatorId });
      
      case 'request_more_info':
        return await requestMoreInfo(report, { reason, moderatorId });
      
      default:
        return { success: false, message: 'Invalid action' };
    }

  } catch (error) {
    logger.error('Error processing report:', error);
    return { success: false, message: 'Report processing failed' };
  }
}

export async function takeDownDocument(documentId, options) {
  try {
    const { reason, notifyUser, adminId } = options;

    const document = await Document.findById(documentId);
    if (!document) {
      return { success: false, message: 'Document not found' };
    }

    const previousStatus = document.status;
    
    document.status = 'taken_down';
    document.takedownReason = reason;
    document.takedownAt = new Date();
    document.takedownBy = adminId;

    await document.save();

    let notificationSent = false;
    if (notifyUser) {
      notificationSent = await notifyUserOfTakedown(document.userId, {
        documentTitle: document.generatedTitle,
        reason,
        appealProcess: true
      });
    }

    await logModerationAction({
      action: 'DOCUMENT_TAKEDOWN',
      moderatorId: adminId,
      documentId,
      details: {
        reason,
        previousStatus,
        notificationSent
      }
    });

    return {
      success: true,
      document,
      notificationSent
    };

  } catch (error) {
    logger.error('Error taking down document:', error);
    return { success: false, message: 'Take down failed' };
  }
}

export async function restoreDocument(documentId, options) {
  try {
    const { reason, adminId } = options;

    const document = await Document.findById(documentId);
    if (!document) {
      return { success: false, message: 'Document not found' };
    }

    if (document.status !== 'taken_down') {
      return { success: false, message: 'Document is not taken down' };
    }

    document.status = document.previousStatus || 'processed';
    document.takedownReason = undefined;
    document.takedownAt = undefined;
    document.takedownBy = undefined;
    document.previousStatus = undefined;

    await document.save();

    await notifyUserOfRestoration(document.userId, {
      documentTitle: document.generatedTitle,
      reason
    });

    await logModerationAction({
      action: 'DOCUMENT_RESTORATION',
      moderatorId: adminId,
      documentId,
      details: { reason }
    });

    return {
      success: true,
      document
    };

  } catch (error) {
    logger.error('Error restoring document:', error);
    return { success: false, message: 'Restoration failed' };
  }
}

export async function generateAdminStats() {
  try {
    const [
      totalUsers,
      totalDocuments,
      pendingModeration,
      pendingPayouts,
      recentUploads,
      systemHealth
    ] = await Promise.all([
      User.countDocuments(),
      Document.countDocuments(),
      Report.countDocuments({ status: 'pending' }),
      Payouts.countDocuments({ status: 'pending' }),
      Document.countDocuments({ 
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
      }),
      getSystemHealth()
    ]);

    const moderationStats = await Report.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const contentStats = await Document.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    return {
      overview: {
        totalUsers,
        totalDocuments,
        pendingModeration,
        pendingPayouts,
        recentUploads
      },
      moderation: {
        byStatus: moderationStats,
        efficiency: await calculateModerationEfficiency()
      },
      content: {
        byStatus: contentStats,
        takedowns: await Document.countDocuments({ status: 'taken_down' })
      },
      system: systemHealth,
      timestamp: new Date()
    };

  } catch (error) {
    logger.error('Error generating admin stats:', error);
    throw error;
  }
}

// Helper functions
async function performAIModeration(document) {
  // Placeholder for AI moderation service
  // This would integrate with services like OpenAI Moderation, Google Perspective, etc.
  
  const mockResult = {
    flagged: Math.random() < 0.05, // 5% chance of flagging
    confidence: Math.random(),
    severity: Math.random() < 0.1 ? 'high' : 'low',
    reasons: ['Potential sensitive content'],
    categories: ['content_quality']
  };

  await new Promise(resolve => setTimeout(resolve, 100));

  return mockResult;
}

async function approveReport(report, { reason, moderatorId }) {
  report.status = 'approved';
  report.resolvedAt = new Date();
  report.resolution = reason;

  await report.addAction('approved', moderatorId, { reason });
  await report.save();

  const actionsTaken = [];
  
  if (report.documentId) {
    const takedown = await takeDownDocument(report.documentId, {
      reason: `Report approved: ${reason}`,
      notifyUser: true,
      adminId: moderatorId
    });

    if (takedown.success) {
      actionsTaken.push('document_takedown');
    }
  }

  if (report.targetUserId) {
    actionsTaken.push('user_notified');
  }

  return {
    success: true,
    report,
    actionsTaken
  };
}

async function rejectReport(report, { reason, moderatorId }) {
  report.status = 'rejected';
  report.resolvedAt = new Date();
  report.resolution = reason;

  await report.addAction('rejected', moderatorId, { reason });
  await report.save();

  return {
    success: true,
    report,
    actionsTaken: ['report_rejected']
  };
}

async function escalateReport(report, { reason, severity, moderatorId }) {
  report.status = 'escalated';
  report.priority = severity || 'high';

  await report.addAction('escalated', moderatorId, { reason, severity });
  await report.save();

  // In production, this might trigger notifications to senior moderators
  await notifySeniorModerators(report);

  return {
    success: true,
    report,
    actionsTaken: ['report_escalated']
  };
}

async function requestMoreInfo(report, { reason, moderatorId }) {
  await report.addAction('info_requested', moderatorId, { reason });

  await notifyReporter(report.reporterId, {
    type: 'more_info_requested',
    reportId: report._id,
    reason
  });

  return {
    success: true,
    report,
    actionsTaken: ['info_requested']
  };
}

async function calculateModerationEfficiency() {
  const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const stats = await Report.aggregate([
    {
      $match: {
        createdAt: { $gte: lastWeek }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        resolved: {
          $sum: {
            $cond: [{ $in: ['$status', ['approved', 'rejected']] }, 1, 0]
          }
        },
        avgResolutionTime: {
          $avg: {
            $cond: [
              { $ne: ['$resolvedAt', null] },
              { $subtract: ['$resolvedAt', '$createdAt'] },
              null
            ]
          }
        }
      }
    }
  ]);

  if (stats.length === 0) {
    return {
      resolutionRate: 0,
      avgResolutionTime: 0,
      efficiencyScore: 0
    };
  }

  const data = stats[0];
  const resolutionRate = data.total > 0 ? (data.resolved / data.total) * 100 : 0;
  const avgResolutionHours = data.avgResolutionTime ? data.avgResolutionTime / (1000 * 60 * 60) : 0;
  
  // Simple efficiency score (0-100)
  const efficiencyScore = Math.min(100, 
    (resolutionRate * 0.7) + 
    (Math.max(0, 100 - (avgResolutionHours / 24 * 100)) * 0.3)
  );

  return {
    resolutionRate: Math.round(resolutionRate),
    avgResolutionTime: Math.round(avgResolutionHours * 100) / 100,
    efficiencyScore: Math.round(efficiencyScore)
  };
}

async function getSystemHealth() {
  return {
    database: mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy',
    redis: redisClient ? 'healthy' : 'unhealthy',
    storage: 'healthy', // Would check S3/cloud storage
    api: 'healthy',
    lastChecked: new Date()
  };
}

async function notifyUserOfTakedown(userId, details) {
  // Placeholder for notification system
  logger.info(`Takedown notification sent to user ${userId}:`, details);
  return true;
}

async function notifyUserOfRestoration(userId, details) {
  // Placeholder for notification system
  logger.info(`Restoration notification sent to user ${userId}:`, details);
  return true;
}

async function notifySeniorModerators(report) {
  // Placeholder for senior moderator notification
  logger.info(`Report ${report._id} escalated to senior moderators`);
}

async function notifyReporter(userId, details) {
  // Placeholder for reporter notification
  logger.info(`Info request notification sent to reporter ${userId}:`, details);
}

async function logModerationAction(actionData) {
  try {
    // In production, this would log to a dedicated moderation actions collection
    logger.info('Moderation action:', actionData);
  } catch (error) {
    logger.error('Error logging moderation action:', error);
  }
}