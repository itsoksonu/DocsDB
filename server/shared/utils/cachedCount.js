import { getRedis } from "./redis.js";
import logger from "./logger.js";

/**
 * countDocuments on a large collection is O(matching docs). The admin
 * dashboard, the feed's "total results" and the category counts all ran one on
 * every request even though the answer barely changes.
 *
 * This memoizes the answer in Redis for `ttlSeconds`, and falls back to
 * computing it directly whenever Redis is unavailable - a stale-tolerant number
 * is fine for pagination totals and dashboard tiles, but a wrong one is not.
 */
export async function cachedCount(key, ttlSeconds, compute) {
  const redis = getRedis();
  const cacheKey = `count:${key}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        const parsed = JSON.parse(cached);
        // Only trust the cache when it round-trips to the shape we stored.
        if (parsed !== null && parsed !== undefined) return parsed;
      }
    } catch (error) {
      logger.error(`Cached count read failed for ${key}:`, error);
    }
  }

  const value = await compute();

  if (redis) {
    try {
      await redis.setEx(cacheKey, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      logger.error(`Cached count write failed for ${key}:`, error);
    }
  }

  return value;
}
