import mongoose from 'mongoose';
import { getRedis } from './redis.js';
import Document from '../models/Document.js';
import logger from './logger.js';

const USER_PREFS_PREFIX = 'user:prefs:';
const PREF_TTL = 86400;


export async function getUserPreferences(userId) {
  try {
    if (getRedis()) {
      const cacheKey = `${USER_PREFS_PREFIX}${userId}`;
      const cached = await getRedis().get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    const preferences = await generateUserPreferences(userId);

    if (getRedis()) {
      const cacheKey = `${USER_PREFS_PREFIX}${userId}`;
      await getRedis().setEx(cacheKey, PREF_TTL, JSON.stringify(preferences));
    }

    return preferences;
  } catch (error) {
    logger.error('Error getting user preferences:', error);
    return null;
  }
}

async function generateUserPreferences(userId) {
  try {
    if (!mongoose.isValidObjectId(userId)) {
      return getDefaultPreferences();
    }

    // Group the user's own documents by category. This used to start from the
    // users collection and $lookup every uploaded document just to count them,
    // with a $match that compared a string id against an ObjectId and so never
    // matched anything.
    const byCategory = await Document.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const docCount = byCategory.reduce((sum, c) => sum + c.count, 0);

    if (docCount === 0) {
      return getDefaultPreferences();
    }

    const preferredCategories = byCategory
      .slice(0, 3)
      .map((c) => c._id)
      .filter(Boolean);

    return {
      preferredCategories: preferredCategories.length > 0
        ? preferredCategories
        : ['technology', 'business', 'education'],
      docCount,
      lastUpdated: new Date()
    };
  } catch (error) {
    logger.error('Error generating user preferences:', error);
    return getDefaultPreferences();
  }
}

function getDefaultPreferences() {
  return {
    preferredCategories: ['technology', 'business', 'education'],
    docCount: 0,
    lastUpdated: new Date()
  };
}

export async function updateUserPreferences(userId, _interactions) {
  try {
    if (getRedis()) {
      const cacheKey = `${USER_PREFS_PREFIX}${userId}`;
      await getRedis().del(cacheKey);
    }

    // In production, this would update preferences based on user interactions
    // For now, we'll just clear the cache to regenerate on next access
    logger.info(`User preferences cache cleared for user: ${userId}`);

    return true;
  } catch (error) {
    logger.error('Error updating user preferences:', error);
    return false;
  }
}