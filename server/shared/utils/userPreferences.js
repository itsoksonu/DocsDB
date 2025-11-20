import databaseManager from '../database/connection.js';
import User from '../models/User.js';
import logger from './logger.js';

const USER_PREFS_PREFIX = 'user:prefs:';
const PREF_TTL = 86400;

const redisClient = databaseManager.getRedisClient();

export async function getUserPreferences(userId) {
  try {
    if (redisClient) {
      const cacheKey = `${USER_PREFS_PREFIX}${userId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    const preferences = await generateUserPreferences(userId);

    if (redisClient) {
      const cacheKey = `${USER_PREFS_PREFIX}${userId}`;
      await redisClient.setEx(cacheKey, PREF_TTL, JSON.stringify(preferences));
    }

    return preferences;
  } catch (error) {
    logger.error('Error getting user preferences:', error);
    return null;
  }
}

async function generateUserPreferences(userId) {
  try {
    const userDocs = await User.aggregate([
      { $match: { _id: userId } },
      {
        $lookup: {
          from: 'documents',
          localField: '_id',
          foreignField: 'userId',
          as: 'uploadedDocs'
        }
      },
      {
        $project: {
          preferredCategories: {
            $ifNull: [
              {
                $reduce: {
                  input: '$uploadedDocs',
                  initialValue: [],
                  in: {
                    $concatArrays: [
                      '$$value',
                      ['$$this.category']
                    ]
                  }
                }
              },
              []
            ]
          },
          docCount: { $size: '$uploadedDocs' }
        }
      }
    ]);

    if (userDocs.length === 0) {
      return getDefaultPreferences();
    }

    const userData = userDocs[0];
    
    const categoryCounts = {};
    userData.preferredCategories.forEach(category => {
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });

    const preferredCategories = Object.entries(categoryCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([category]) => category);

    return {
      preferredCategories: preferredCategories.length > 0 
        ? preferredCategories 
        : ['technology', 'business', 'education'],
      docCount: userData.docCount,
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

export async function updateUserPreferences(userId, interactions) {
  try {
    if (redisClient) {
      const cacheKey = `${USER_PREFS_PREFIX}${userId}`;
      await redisClient.del(cacheKey);
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