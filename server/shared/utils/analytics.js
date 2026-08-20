import crypto from 'crypto';
import DocumentDailyStat, { utcDay } from '../models/DocumentDailyStat.js';
import Document from '../models/Document.js';
import { claimEvent, incrementCounter, pendingFor } from './counters.js';
import { getRedis } from './redis.js';
import logger from './logger.js';

const VIEW_DURATION_THRESHOLD = 3000; // 3 seconds minimum for monetization

// Anonymous viewers are deduped by IP, which we never store in the clear.
function viewerKey(userId, ipAddress) {
  if (userId) return `u:${userId}`;
  if (!ipAddress) return 'anon';
  return `i:${crypto.createHash('sha256').update(String(ipAddress)).digest('hex').slice(0, 16)}`;
}

export async function trackView(documentId, userId, ipAddress) {
  try {
    const fresh = await claimEvent('views', documentId, viewerKey(userId, ipAddress));
    if (!fresh) {
      logger.debug(`Duplicate view ignored for document ${documentId}`);
      return false;
    }

    await incrementCounter(documentId, 'views');
    return true;
  } catch (error) {
    logger.error('Error tracking view:', error);
    return false;
  }
}

export async function trackViewDuration(documentId, userId, durationMs) {
  try {
    if (durationMs < VIEW_DURATION_THRESHOLD) {
      return;
    }

    logger.info(`View duration tracked: ${durationMs}ms for document ${documentId} by user ${userId}`);

    // In production, this would send to analytics service
    // For now, we'll just log it

  } catch (error) {
    logger.error('Error tracking view duration:', error);
  }
}

export async function trackDownload(documentId, userId, ipAddress) {
  try {
    const fresh = await claimEvent('downloads', documentId, viewerKey(userId, ipAddress));
    if (!fresh) {
      logger.debug(`Duplicate download ignored for document ${documentId}`);
      return false;
    }

    await incrementCounter(documentId, 'downloads');
    return true;
  } catch (error) {
    logger.error('Error tracking download:', error);
    return false;
  }
}

/**
 * Real numbers from the daily rollups. This used to return Math.random().
 * `days` is capped so a hand-typed query string cannot ask for a decade.
 */
export async function getDocumentViewStats(documentId, timeframe = '7d') {
  try {
    const days = Math.min(Math.max(parseInt(timeframe, 10) || 7, 1), 365);
    const cacheKey = `stats:views:${documentId}:${days}d`;
    const redis = getRedis();

    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    const since = utcDay();
    since.setUTCDate(since.getUTCDate() - (days - 1));

    const [rows, document, pending] = await Promise.all([
      DocumentDailyStat.find({ documentId, date: { $gte: since } })
        .sort({ date: 1 })
        .lean(),
      Document.findById(documentId).select('viewsCount downloadsCount').lean(),
      pendingFor(documentId),
    ]);

    const byDate = new Map(
      rows.map((r) => [r.date.toISOString().slice(0, 10), r])
    );

    const series = [];
    for (let i = 0; i < days; i += 1) {
      const day = new Date(since);
      day.setUTCDate(day.getUTCDate() + i);
      const key = day.toISOString().slice(0, 10);
      const row = byDate.get(key);
      series.push({
        date: key,
        views: row?.views || 0,
        downloads: row?.downloads || 0,
      });
    }

    const stats = {
      totalViews: (document?.viewsCount || 0) + (pending.views || 0),
      totalDownloads: (document?.downloadsCount || 0) + (pending.downloads || 0),
      viewsInPeriod: series.reduce((sum, d) => sum + d.views, 0),
      downloadsInPeriod: series.reduce((sum, d) => sum + d.downloads, 0),
      viewsByDay: series,
    };

    if (redis) {
      await redis.setEx(cacheKey, 900, JSON.stringify(stats)); // 15 minutes cache
    }

    return stats;
  } catch (error) {
    logger.error('Error getting view stats:', error);
    return null;
  }
}
