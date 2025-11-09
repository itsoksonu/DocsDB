import databaseManager from '../database/connection.js';
import Document from '../models/Document.js';
import logger from './logger.js';

const VIEW_TRACKING_PREFIX = 'view:track:';
const VIEW_DURATION_THRESHOLD = 3000; // 3 seconds minimum for monetization

const redisClient = databaseManager.getRedisClient();

export async function trackView(documentId, userId, ipAddress) {
  try {
    const now = Date.now();
    const viewKey = `${VIEW_TRACKING_PREFIX}${documentId}:${userId}:${now}`;

    // Check for duplicate views within short period (5 minutes)
    const recentViews = await checkRecentViews(documentId, userId, ipAddress);
    if (recentViews > 0) {
      logger.debug(`Duplicate view detected for document ${documentId} by user ${userId}`);
      return;
    }

    // Record view with temporary key (expires in 5 minutes)
    if (redisClient) {
      await redisClient.setEx(viewKey, 300, '1');
      
      // Also track by IP for fraud detection
      const ipKey = `view:ip:${ipAddress}:${documentId}`;
      await redisClient.setEx(ipKey, 300, '1');
    }

    // Increment view count in database (non-blocking)
    Document.findByIdAndUpdate(documentId, {
      $inc: { viewsCount: 1 }
    }).catch(error => {
      logger.error('Error incrementing view count:', error);
    });

    // Log view for monetization processing
    logViewEvent({
      documentId,
      userId,
      ipAddress,
      timestamp: new Date(now)
    });

    logger.info(`View tracked for document ${documentId} by user ${userId}`);
  } catch (error) {
    logger.error('Error tracking view:', error);
  }
}

export async function trackViewDuration(documentId, userId, durationMs) {
  try {
    // Only count views longer than threshold for monetization
    if (durationMs < VIEW_DURATION_THRESHOLD) {
      return;
    }

    // Log duration for analytics
    logger.info(`View duration tracked: ${durationMs}ms for document ${documentId} by user ${userId}`);

    // In production, this would send to analytics service
    // For now, we'll just log it

  } catch (error) {
    logger.error('Error tracking view duration:', error);
  }
}

export async function trackDownload(documentId, userId, ipAddress) {
  try {
    // Check for duplicate downloads within short period
    const downloadKey = `download:${documentId}:${userId}:${Date.now()}`;
    
    if (redisClient) {
      const recentDownloads = await checkRecentDownloads(documentId, userId, ipAddress);
      if (recentDownloads > 0) {
        logger.debug(`Duplicate download detected for document ${documentId} by user ${userId}`);
        return false;
      }

      await redisClient.setEx(downloadKey, 300, '1');
    }

    // Increment download count
    await Document.findByIdAndUpdate(documentId, {
      $inc: { downloadsCount: 1 }
    });

    // Log download for monetization
    logDownloadEvent({
      documentId,
      userId,
      ipAddress,
      timestamp: new Date()
    });

    logger.info(`Download tracked for document ${documentId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error tracking download:', error);
    return false;
  }
}

async function checkRecentViews(documentId, userId, ipAddress) {
  if (!redisClient) return 0;

  try {
    // Check user-based views
    const userPattern = `${VIEW_TRACKING_PREFIX}${documentId}:${userId}:*`;
    const userViews = await redisClient.keys(userPattern);

    // Check IP-based views for fraud detection
    const ipPattern = `view:ip:${ipAddress}:${documentId}`;
    const ipViews = await redisClient.keys(ipPattern);

    return userViews.length + ipViews.length;
  } catch (error) {
    logger.error('Error checking recent views:', error);
    return 0;
  }
}

async function checkRecentDownloads(documentId, userId, ipAddress) {
  if (!redisClient) return 0;

  try {
    const pattern = `download:${documentId}:${userId}:*`;
    const downloads = await redisClient.keys(pattern);
    return downloads.length;
  } catch (error) {
    logger.error('Error checking recent downloads:', error);
    return 0;
  }
}

function logViewEvent(eventData) {
  // In production, this would send to Kafka or similar event stream
  // For monetization and analytics processing
  logger.info('View event:', eventData);
}

function logDownloadEvent(eventData) {
  // In production, this would send to event stream
  logger.info('Download event:', eventData);
}

// Get view statistics for a document
export async function getDocumentViewStats(documentId, timeframe = '7d') {
  try {
    const cacheKey = `stats:views:${documentId}:${timeframe}`;
    
    if (redisClient) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    // Simplified stats - in production, query from analytics database
    const stats = {
      totalViews: Math.floor(Math.random() * 1000),
      uniqueViews: Math.floor(Math.random() * 500),
      averageDuration: Math.floor(Math.random() * 180), // seconds
      viewsByDay: generateDailyViews(7)
    };

    if (redisClient) {
      await redisClient.setEx(cacheKey, 900, JSON.stringify(stats)); // 15 minutes cache
    }

    return stats;
  } catch (error) {
    logger.error('Error getting view stats:', error);
    return null;
  }
}

function generateDailyViews(days) {
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    result.push({
      date: date.toISOString().split('T')[0],
      views: Math.floor(Math.random() * 50)
    });
  }
  return result;
}