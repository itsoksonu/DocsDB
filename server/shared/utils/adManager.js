import Document from '../models/Document.js';
import { getRedis } from './redis.js';
import logger from './logger.js';

// Cache for sponsored documents
const SPONSORED_CACHE_KEY = 'sponsored:documents';
const CACHE_TTL = 300; // 5 minutes


export async function getSponsoredDocuments(limit = 10) {
  try {
    if (getRedis()) {
      const cached = await getRedis().get(SPONSORED_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached).slice(0, limit);
      }
    }

    // Get sponsored documents from database
    // In production, this would have a separate sponsored collection
    const sponsoredDocs = await Document.find({
      status: 'processed',
      visibility: 'public',
      'metadata.isSponsored': true // Example field for sponsored docs
    })
    .select('-metadata -embeddingsId')
    .populate('userId', 'name')
    .sort({ 'metadata.sponsorPriority': -1, createdAt: -1 })
    .limit(limit * 2); // Get more for variety

    if (getRedis() && sponsoredDocs.length > 0) {
      await getRedis().setEx(SPONSORED_CACHE_KEY, CACHE_TTL, JSON.stringify(sponsoredDocs));
    }

    return sponsoredDocs.slice(0, limit);
  } catch (error) {
    logger.error('Error fetching sponsored documents:', error);
    return [];
  }
}

export async function trackAdImpression(adId, userId, documentId = null) {
  try {
    const impressionData = {
      adId,
      userId,
      documentId,
      timestamp: new Date(),
      type: 'impression'
    };

    // In production, this would send to analytics service
    logger.info('Ad impression tracked:', impressionData);

    if (getRedis()) {
      const key = `ad:metrics:${adId}`;
      await getRedis().hIncrBy(key, 'impressions', 1);
      await getRedis().expire(key, 86400); // 24 hours TTL
    }

    return true;
  } catch (error) {
    logger.error('Error tracking ad impression:', error);
    return false;
  }
}

export async function trackAdClick(adId, userId, documentId = null) {
  try {
    const clickData = {
      adId,
      userId,
      documentId,
      timestamp: new Date(),
      type: 'click'
    };

    logger.info('Ad click tracked:', clickData);

    if (getRedis()) {
      const key = `ad:metrics:${adId}`;
      await getRedis().hIncrBy(key, 'clicks', 1);
    }

    return true;
  } catch (error) {
    logger.error('Error tracking ad click:', error);
    return false;
  }
}

export async function getAdMetrics(adId) {
  try {
    if (!getRedis()) {
      return null;
    }

    const key = `ad:metrics:${adId}`;
    const metrics = await getRedis().hGetAll(key);

    if (!metrics.impressions) {
      return null;
    }

    return {
      impressions: parseInt(metrics.impressions) || 0,
      clicks: parseInt(metrics.clicks) || 0,
      ctr: metrics.impressions > 0 ? (parseInt(metrics.clicks) / parseInt(metrics.impressions)) : 0
    };
  } catch (error) {
    logger.error('Error getting ad metrics:', error);
    return null;
  }
}