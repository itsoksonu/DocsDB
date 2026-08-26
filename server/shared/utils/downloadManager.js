import crypto from 'crypto';
import Document from '../models/Document.js';
import { getRedis } from './redis.js';
import { getSponsoredDocuments } from './adManager.js';
import logger from './logger.js';

const DOWNLOAD_SESSION_TTL = 1800; // 30 minutes
const DOWNLOAD_TIMER_DURATION = 10000; // 10 seconds
const MAX_DOWNLOADS_PER_HOUR = 10;


export async function validateDownloadRequest(documentId, userId, userIp) {
  try {
    const document = await Document.findById(documentId);
    if (!document) {
      return { valid: false, statusCode: 404, message: 'Document not found' };
    }

    if (!document.isViewable()) {
      return { valid: false, statusCode: 403, message: 'Document is not available for download' };
    }

    if (document.userId.toString() === userId) {
      return { 
        valid: true, 
        document, 
        adRequired: false, 
        timerDuration: 0 
      };
    }

    const downloadLimit = await checkDownloadLimits(userId, userIp);
    if (!downloadLimit.allowed) {
      return { 
        valid: false, 
        statusCode: 429, 
        message: downloadLimit.message 
      };
    }

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

    const document = await Document.findById(documentId);
    if (document && document.userId.toString() === userId) {
      sessionData.adRequired = false;
      sessionData.timerDuration = 0;
    }

    if (getRedis()) {
      await getRedis().setEx(
        `download:session:${sessionId}`, 
        DOWNLOAD_SESSION_TTL, 
        JSON.stringify(sessionData)
      );
    }

    await trackDownloadAttempt(documentId, userId, userIp);

    logger.info(`Download session created: ${sessionId} for document ${documentId}`);

    return sessionData;
  } catch (error) {
    logger.error('Error creating download session:', error);
    throw error;
  }
}

export async function completeDownloadSession(sessionId, userId, documentId) {
  try {
    if (!getRedis()) {
      return { valid: false, message: 'Session storage unavailable' };
    }

    const sessionKey = `download:session:${sessionId}`;
    const sessionData = await getRedis().get(sessionKey);

    if (!sessionData) {
      return { valid: false, message: 'Download session expired or invalid' };
    }

    const session = JSON.parse(sessionData);

    if (session.userId !== userId) {
      return { valid: false, message: 'Invalid session for user' };
    }

    // The session must be the one created for this document. Without this check
    // a session opened against the caller's own document (which skips the ad and
    // timer) could be redeemed for any other document id, bypassing
    // validateDownloadRequest entirely.
    if (session.documentId !== documentId) {
      return { valid: false, message: 'Session does not match document' };
    }

    if (session.completed) {
      return { valid: false, message: 'Download already completed' };
    }

    const now = Date.now();
    const sessionAge = now - session.createdAt;

    if (session.adRequired) {
      if (sessionAge < session.timerDuration) {
        return { valid: false, message: 'Download timer not completed' };
      }

      // Only the server-side flag set by POST /ad/view counts. A client-supplied
      // "adCompleted" boolean would make the ad gate opt-out.
      if (!session.adViewed) {
        return { valid: false, message: 'Ad viewing required' };
      }
    }

    session.completed = true;
    session.completedAt = now;
    
    await getRedis().setEx(sessionKey, 300, JSON.stringify(session)); // Keep for 5 more minutes

    await recordDownloadCompletion(session.documentId, userId, session.userIp);

    return { valid: true, session };

  } catch (error) {
    logger.error('Error completing download session:', error);
    return { valid: false, message: 'Internal server error' };
  }
}

export async function getAdForDownload(_userId) {
  try {
    const sponsoredDocs = await getSponsoredDocuments(1);
    
    if (sponsoredDocs.length === 0) {
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
    if (!getRedis()) {
      return { allowed: true };
    }

    const now = Date.now();
    const hourWindow = 60 * 60 * 1000; // 1 hour
    
    const userKey = `download:limits:user:${userId}`;
    const userDownloads = await getRecentDownloadsCount(userKey, hourWindow);
    
    if (userDownloads >= MAX_DOWNLOADS_PER_HOUR) {
      return { 
        allowed: false, 
        message: 'Download limit reached. Please try again in an hour.' 
      };
    }

    const ipKey = `download:limits:ip:${userIp}`;
    const ipDownloads = await getRecentDownloadsCount(ipKey, hourWindow);
    
    if (ipDownloads >= MAX_DOWNLOADS_PER_HOUR * 2) { 
      return { 
        allowed: false, 
        message: 'Too many downloads from this network. Please try again later.' 
      };
    }

    await recordDownloadAttempt(userKey, now);
    await recordDownloadAttempt(ipKey, now);

    return { allowed: true };
  } catch (error) {
    logger.error('Error checking download limits:', error);
    return { allowed: true }; 
  }
}

async function getRecentDownloadsCount(key, windowMs) {
  if (!getRedis()) return 0;

  try {
    const now = Date.now();
    const downloads = await getRedis().lRange(key, 0, -1);
    
    const recentDownloads = downloads.filter(timestamp => {
      return now - parseInt(timestamp) <= windowMs;
    });

    if (downloads.length !== recentDownloads.length) {
      await getRedis().del(key);
      if (recentDownloads.length > 0) {
        await getRedis().rPush(key, recentDownloads);
      }
    }

    return recentDownloads.length;
  } catch (error) {
    logger.error('Error getting recent downloads count:', error);
    return 0;
  }
}

async function recordDownloadAttempt(key, timestamp) {
  if (!getRedis()) return;

  try {
    // lTrim caps the list: the only pruning used to happen incidentally inside
    // getRecentDownloadsCount, so a busy key could grow without limit. The TTL
    // is set with NX so it is not refreshed on every push - an active user or a
    // shared NAT address previously kept its key alive forever.
    await getRedis()
      .multi()
      .rPush(key, timestamp.toString())
      .lTrim(key, -(MAX_DOWNLOADS_PER_HOUR * 3), -1)
      .expire(key, 24 * 60 * 60, 'NX')
      .exec();
  } catch (error) {
    logger.error('Error recording download attempt:', error);
  }
}

async function checkRecentDownload(documentId, userId) {
  if (!getRedis()) return false;

  try {
    const key = `download:recent:${userId}:${documentId}`;
    const recent = await getRedis().get(key);
    return !!recent;
  } catch (error) {
    logger.error('Error checking recent download:', error);
    return false;
  }
}

async function recordDownloadCompletion(documentId, userId, _userIp) {
  if (!getRedis()) return;

  try {
    const recentKey = `download:recent:${userId}:${documentId}`;
    await getRedis().setEx(recentKey, 3600, '1'); // 1 hour TTL

    const analyticsKey = `analytics:downloads:${documentId}`;
    await getRedis().incr(analyticsKey);
    await getRedis().expire(analyticsKey, 7 * 24 * 60 * 60); // 7 days TTL

    logger.info(`Download completed: user ${userId} downloaded document ${documentId}`);
  } catch (error) {
    logger.error('Error recording download completion:', error);
  }
}

async function trackDownloadAttempt(documentId, userId, userIp) {
  logger.info(`Download attempt: user ${userId} for document ${documentId} from IP ${userIp}`);
}

// Session ids are bearer credentials for a signed download URL, so they must be
// unguessable - Date.now() + Math.random() is neither uniform nor unpredictable.
function generateSessionId() {
  return `dl_${crypto.randomBytes(16).toString('hex')}`;
}

// Note: the previous cleanupExpiredSessions() helper was removed. It was never
// called, and session keys already carry a Redis TTL (see createDownloadSession),
// so the O(keyspace) `KEYS` scan it performed was both redundant and blocking.