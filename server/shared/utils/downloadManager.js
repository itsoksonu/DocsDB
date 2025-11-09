import Document from '../models/Document.js';
import databaseManager from '../database/connection.js';
import { getSponsoredDocuments } from './adManager.js';
import logger from './logger.js';

const DOWNLOAD_SESSION_TTL = 1800; // 30 minutes
const DOWNLOAD_TIMER_DURATION = 10000; // 10 seconds
const MAX_DOWNLOADS_PER_HOUR = 10;

const redisClient = databaseManager.getRedisClient();

export async function validateDownloadRequest(documentId, userId, userIp) {
  try {
    // Check if document exists and is accessible
    const document = await Document.findById(documentId);
    if (!document) {
      return { valid: false, statusCode: 404, message: 'Document not found' };
    }

    if (!document.isViewable()) {
      return { valid: false, statusCode: 403, message: 'Document is not available for download' };
    }

    // Check if user is trying to download their own document
    if (document.userId.toString() === userId) {
      return { 
        valid: true, 
        document, 
        adRequired: false, 
        timerDuration: 0 
      };
    }

    // Check download limits
    const downloadLimit = await checkDownloadLimits(userId, userIp);
    if (!downloadLimit.allowed) {
      return { 
        valid: false, 
        statusCode: 429, 
        message: downloadLimit.message 
      };
    }

    // Check if user has already downloaded this document recently
    const recentDownload = await checkRecentDownload(documentId, userId);
    if (recentDownload) {
      return { 
        valid: false, 
        statusCode: 400, 
        message: 'You have already downloaded this document recently' 
      };
    }

    return { 
      valid: true, 
      document, 
      adRequired: true, 
      timerDuration: DOWNLOAD_TIMER_DURATION 
    };

  } catch (error) {
    logger.error('Error validating download request:', error);
    return { valid: false, statusCode: 500, message: 'Internal server error' };
  }
}

export async function createDownloadSession({ documentId, userId, userIp, userAgent }) {
  try {
    const sessionId = generateSessionId();
    const now = Date.now();
    
    const sessionData = {
      sessionId,
      documentId,
      userId,
      userIp,
      userAgent,
      createdAt: now,
      expiresAt: now + (DOWNLOAD_SESSION_TTL * 1000),
      adRequired: true,
      timerDuration: DOWNLOAD_TIMER_DURATION,
      adViewed: false,
      completed: false,
      ttl: DOWNLOAD_SESSION_TTL
    };

    // Check if user owns the document
    const document = await Document.findById(documentId);
    if (document && document.userId.toString() === userId) {
      sessionData.adRequired = false;
      sessionData.timerDuration = 0;
    }

    // Store session in Redis
    if (redisClient) {
      await redisClient.setEx(
        `download:session:${sessionId}`, 
        DOWNLOAD_SESSION_TTL, 
        JSON.stringify(sessionData)
      );
    }

    // Track download attempt
    await trackDownloadAttempt(documentId, userId, userIp);

    logger.info(`Download session created: ${sessionId} for document ${documentId}`);

    return sessionData;
  } catch (error) {
    logger.error('Error creating download session:', error);
    throw error;
  }
}

export async function completeDownloadSession(sessionId, userId, adCompleted = false) {
  try {
    if (!redisClient) {
      return { valid: false, message: 'Session storage unavailable' };
    }

    // Retrieve session
    const sessionKey = `download:session:${sessionId}`;
    const sessionData = await redisClient.get(sessionKey);
    
    if (!sessionData) {
      return { valid: false, message: 'Download session expired or invalid' };
    }

    const session = JSON.parse(sessionData);

    // Validate session ownership
    if (session.userId !== userId) {
      return { valid: false, message: 'Invalid session for user' };
    }

    // Check if session is already completed
    if (session.completed) {
      return { valid: false, message: 'Download already completed' };
    }

    // Validate timer and ad requirements
    const now = Date.now();
    const sessionAge = now - session.createdAt;

    if (session.adRequired) {
      // Check if timer has elapsed
      if (sessionAge < session.timerDuration) {
        return { valid: false, message: 'Download timer not completed' };
      }

      // Check if ad was viewed (if required)
      if (!session.adViewed && !adCompleted) {
        return { valid: false, message: 'Ad viewing required' };
      }
    }

    // Mark session as completed
    session.completed = true;
    session.completedAt = now;
    
    await redisClient.setEx(sessionKey, 300, JSON.stringify(session)); // Keep for 5 more minutes

    // Record successful download
    await recordDownloadCompletion(session.documentId, userId, session.userIp);

    return { valid: true, session };

  } catch (error) {
    logger.error('Error completing download session:', error);
    return { valid: false, message: 'Internal server error' };
  }
}

export async function getAdForDownload(userId) {
  try {
    // Get a sponsored document to show as ad
    const sponsoredDocs = await getSponsoredDocuments(1);
    
    if (sponsoredDocs.length === 0) {
      // Fallback ad
      return {
        adId: 'default_ad',
        type: 'interstitial',
        title: 'Upgrade to Premium',
        description: 'Get ad-free downloads and premium features',
        imageUrl: null,
        duration: 5,
        clickUrl: `${process.env.FRONTEND_URL}/premium`,
        trackingUrl: `${process.env.API_URL}/tracking/ad/impression`
      };
    }

    const doc = sponsoredDocs[0];
    return {
      adId: `doc_ad_${doc._id}`,
      type: 'document_promotion',
      title: doc.generatedTitle,
      description: doc.generatedDescription,
      imageUrl: doc.thumbnailS3Path,
      duration: 8,
      clickUrl: `${process.env.FRONTEND_URL}/documents/${doc._id}`,
      trackingUrl: `${process.env.API_URL}/tracking/ad/impression/${doc._id}`
    };
  } catch (error) {
    logger.error('Error getting ad for download:', error);
    return null;
  }
}

// Helper functions
async function checkDownloadLimits(userId, userIp) {
  try {
    if (!redisClient) {
      return { allowed: true };
    }

    const now = Date.now();
    const hourWindow = 60 * 60 * 1000; // 1 hour
    
    // Check user-based limits
    const userKey = `download:limits:user:${userId}`;
    const userDownloads = await getRecentDownloadsCount(userKey, hourWindow);
    
    if (userDownloads >= MAX_DOWNLOADS_PER_HOUR) {
      return { 
        allowed: false, 
        message: 'Download limit reached. Please try again in an hour.' 
      };
    }

    // Check IP-based limits (for fraud prevention)
    const ipKey = `download:limits:ip:${userIp}`;
    const ipDownloads = await getRecentDownloadsCount(ipKey, hourWindow);
    
    if (ipDownloads >= MAX_DOWNLOADS_PER_HOUR * 2) { // Higher limit for IP
      return { 
        allowed: false, 
        message: 'Too many downloads from this network. Please try again later.' 
      };
    }

    // Record this download attempt
    await recordDownloadAttempt(userKey, now);
    await recordDownloadAttempt(ipKey, now);

    return { allowed: true };
  } catch (error) {
    logger.error('Error checking download limits:', error);
    return { allowed: true }; // Fail open
  }
}

async function getRecentDownloadsCount(key, windowMs) {
  if (!redisClient) return 0;

  try {
    const now = Date.now();
    const downloads = await redisClient.lRange(key, 0, -1);
    
    // Filter downloads within the time window
    const recentDownloads = downloads.filter(timestamp => {
      return now - parseInt(timestamp) <= windowMs;
    });

    // Clean up old entries
    if (downloads.length !== recentDownloads.length) {
      await redisClient.del(key);
      if (recentDownloads.length > 0) {
        await redisClient.rPush(key, recentDownloads);
      }
    }

    return recentDownloads.length;
  } catch (error) {
    logger.error('Error getting recent downloads count:', error);
    return 0;
  }
}

async function recordDownloadAttempt(key, timestamp) {
  if (!redisClient) return;

  try {
    await redisClient.rPush(key, timestamp.toString());
    await redisClient.expire(key, 24 * 60 * 60); // 24 hours TTL
  } catch (error) {
    logger.error('Error recording download attempt:', error);
  }
}

async function checkRecentDownload(documentId, userId) {
  if (!redisClient) return false;

  try {
    const key = `download:recent:${userId}:${documentId}`;
    const recent = await redisClient.get(key);
    return !!recent;
  } catch (error) {
    logger.error('Error checking recent download:', error);
    return false;
  }
}

async function recordDownloadCompletion(documentId, userId, userIp) {
  if (!redisClient) return;

  try {
    // Mark as recently downloaded (prevent immediate re-downloads)
    const recentKey = `download:recent:${userId}:${documentId}`;
    await redisClient.setEx(recentKey, 3600, '1'); // 1 hour TTL

    // Record for analytics
    const analyticsKey = `analytics:downloads:${documentId}`;
    await redisClient.incr(analyticsKey);
    await redisClient.expire(analyticsKey, 7 * 24 * 60 * 60); // 7 days TTL

    logger.info(`Download completed: user ${userId} downloaded document ${documentId}`);
  } catch (error) {
    logger.error('Error recording download completion:', error);
  }
}

async function trackDownloadAttempt(documentId, userId, userIp) {
  // Log download attempt for analytics
  logger.info(`Download attempt: user ${userId} for document ${documentId} from IP ${userIp}`);
}

function generateSessionId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 16);
  return `dl_${timestamp}_${random}`;
}

// Clean up expired sessions (cron job)
export async function cleanupExpiredSessions() {
  if (!redisClient) return;

  try {
    // This would be more efficient with Redis TTL, but we'll check periodically
    const sessionKeys = await redisClient.keys('download:session:*');
    const now = Date.now();
    
    let cleaned = 0;
    
    for (const key of sessionKeys) {
      const sessionData = await redisClient.get(key);
      if (sessionData) {
        const session = JSON.parse(sessionData);
        if (session.expiresAt < now) {
          await redisClient.del(key);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired download sessions`);
    }
  } catch (error) {
    logger.error('Error cleaning up expired sessions:', error);
  }
}