import Earnings from '../models/Earnings.js';
import Payouts from '../models/Payouts.js';
import User from '../models/User.js';
import Document from '../models/Document.js';
import databaseManager from '../database/connection.js';
import logger from './logger.js';

// Monetization rates (in USD)
const RATES = {
  CPM: 0.02, // $0.02 per 1000 views
  DOWNLOAD: 0.20, // $0.20 per download
  REVENUE_SHARE: 0.70 // 70% to creator
};

// Minimum thresholds
const MIN_VIEW_DURATION = 3000; // 3 seconds
const MIN_PAYOUT_AMOUNT = 50; // $50

const redisClient = databaseManager.getRedisClient();

export async function calculateEarnings(eventType, data) {
  try {
    const { documentId, userId, duration, country, deviceType, adType } = data;

    // Get document to check monetization status
    const document = await Document.findById(documentId);
    if (!document || !document.monetizationEnabled) {
      return 0;
    }

    let amount = 0;
    const metadata = {
      sharePercentage: RATES.REVENUE_SHARE * 100,
      country,
      deviceType
    };

    switch (eventType) {
      case 'view':
        // Only count views with sufficient duration
        if (duration >= MIN_VIEW_DURATION) {
          amount = (RATES.CPM / 1000) * RATES.REVENUE_SHARE;
          metadata.cpm = RATES.CPM;
          metadata.viewDuration = duration;
          metadata.adType = adType || 'banner';
        }
        break;

      case 'download':
        amount = RATES.DOWNLOAD * RATES.REVENUE_SHARE;
        metadata.adType = 'interstitial';
        break;

      case 'sponsored':
        // Sponsored content has custom rates
        amount = data.customRate || (RATES.CPM * 2 / 1000) * RATES.REVENUE_SHARE;
        metadata.cpm = RATES.CPM * 2;
        metadata.adType = 'sponsored';
        break;

      default:
        return 0;
    }

    // Apply geo-based adjustments
    amount = applyGeoAdjustment(amount, country);

    // Ensure minimum earnings
    if (amount < 0.0001) {
      return 0;
    }

    // Create earnings record
    const earnings = new Earnings({
      userId: document.userId, // Earnings go to document owner
      documentId,
      amount,
      type: eventType,
      eventId: generateEventId(eventType, data),
      metadata
    });

    await earnings.save();

    // Update user's wallet balance (non-blocking)
    updateWalletBalance(document.userId, amount).catch(error => {
      logger.error('Error updating wallet balance:', error);
    });

    logger.info(`Earnings recorded: ${amount} for ${eventType} on document ${documentId}`);

    return amount;
  } catch (error) {
    logger.error('Error calculating earnings:', error);
    return 0;
  }
}

export async function trackMonetizationEvent(eventType, data) {
  try {
    // Basic fraud detection
    if (await isFraudulentEvent(data)) {
      logger.warn(`Potential fraudulent event detected: ${eventType}`, data);
      return false;
    }

    // Calculate and record earnings
    const amount = await calculateEarnings(eventType, data);

    // Track in analytics
    logMonetizationEvent(eventType, data, amount);

    return amount > 0;
  } catch (error) {
    logger.error('Error tracking monetization event:', error);
    return false;
  }
}

export async function processPayout(userId, amount) {
  try {
    // Verify user and balance
    const user = await User.findById(userId);
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    if (user.walletBalance < amount) {
      return { success: false, message: 'Insufficient balance' };
    }

    if (amount < MIN_PAYOUT_AMOUNT) {
      return { 
        success: false, 
        message: `Minimum payout amount is $${MIN_PAYOUT_AMOUNT}` 
      };
    }

    // Check if user has valid payout method
    if (!user.payoutDetails?.stripeAccountId) {
      return { 
        success: false, 
        message: 'Please set up payout method first' 
      };
    }

    // Create payout record
    const payout = new Payouts({
      userId,
      amount,
      method: 'stripe',
      estimatedArrival: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });

    await payout.save();

    // Deduct from user's wallet balance
    user.walletBalance -= amount;
    await user.save();

    // In production, this would trigger actual payment processing
    // For now, we'll just create the record

    return {
      success: true,
      payoutId: payout._id,
      amount,
      estimatedArrival: payout.estimatedArrival
    };

  } catch (error) {
    logger.error('Error processing payout:', error);
    return { success: false, message: 'Failed to process payout' };
  }
}

export async function getEarningsSummary(userId, timeframe = 'month', page = 1, limit = 50) {
  try {
    const timeFilter = getTimeFilter(timeframe);
    const skip = (page - 1) * limit;

    const [earnings, totalEarnings, earningsByType, recentEarnings] = await Promise.all([
      // Recent earnings with pagination
      Earnings.find({ 
        userId, 
        processed: true,
        createdAt: timeFilter
      })
      .populate('documentId', 'generatedTitle fileType')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

      // Total earnings
      Earnings.aggregate([
        { 
          $match: { 
            userId: new mongoose.Types.ObjectId(userId),
            processed: true,
            createdAt: timeFilter
          } 
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),

      // Earnings by type
      Earnings.aggregate([
        { 
          $match: { 
            userId: new mongoose.Types.ObjectId(userId),
            processed: true,
            createdAt: timeFilter
          } 
        },
        { 
          $group: { 
            _id: '$type',
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          } 
        }
      ]),

      // Recent earnings for chart
      Earnings.aggregate([
        { 
          $match: { 
            userId: new mongoose.Types.ObjectId(userId),
            processed: true,
            createdAt: timeFilter
          } 
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
            },
            dailyEarnings: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } },
        { $limit: 30 }
      ])
    ]);

    const total = totalEarnings[0]?.total || 0;

    return {
      summary: {
        totalEarnings: total,
        estimatedEarnings: await getEstimatedEarnings(userId),
        walletBalance: await getWalletBalance(userId),
        timeframe
      },
      breakdown: {
        byType: earningsByType,
        recent: recentEarnings
      },
      recentEarnings: {
        earnings,
        pagination: {
          page,
          limit,
          total: earnings.length,
          hasMore: earnings.length === limit
        }
      }
    };

  } catch (error) {
    logger.error('Error getting earnings summary:', error);
    throw error;
  }
}

// Helper functions
function applyGeoAdjustment(amount, country) {
  const geoMultipliers = {
    'US': 1.0,
    'CA': 0.9,
    'UK': 0.8,
    'EU': 0.7,
    'OTHER': 0.5
  };

  const multiplier = geoMultipliers[country] || geoMultipliers['OTHER'];
  return amount * multiplier;
}

function generateEventId(eventType, data) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `${eventType}_${data.documentId}_${timestamp}_${random}`;
}

async function updateWalletBalance(userId, amount) {
  await User.findByIdAndUpdate(userId, {
    $inc: { walletBalance: amount }
  });
}

async function getWalletBalance(userId) {
  const user = await User.findById(userId).select('walletBalance');
  return user?.walletBalance || 0;
}

async function getEstimatedEarnings(userId) {
  // Get unprocessed earnings
  const result = await Earnings.aggregate([
    { 
      $match: { 
        userId: new mongoose.Types.ObjectId(userId),
        processed: false
      } 
    },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  return result[0]?.total || 0;
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
    case 'all':
    default:
      startDate = new Date(0); // Beginning of time
  }

  return { $gte: startDate };
}

async function isFraudulentEvent(data) {
  // Basic fraud detection
  const { userId, documentId, ipAddress } = data;

  // Check rate limits using Redis
  if (redisClient) {
    const key = `fraud:${userId}:${documentId}:${ipAddress}`;
    const attempts = await redisClient.incr(key);
    await redisClient.expire(key, 3600); // 1 hour TTL

    if (attempts > 10) { // More than 10 events per hour from same user-document-ip combo
      return true;
    }
  }

  // Additional fraud checks would go here
  // - IP reputation
  // - User behavior patterns
  // - Device fingerprinting
  // - etc.

  return false;
}

function logMonetizationEvent(eventType, data, amount) {
  // In production, this would send to analytics service
  logger.info('Monetization event:', {
    eventType,
    documentId: data.documentId,
    userId: data.userId,
    amount,
    timestamp: new Date()
  });
}

// Cron job to process earnings (would be called by a scheduled job)
export async function processPendingEarnings() {
  try {
    const pendingEarnings = await Earnings.find({ 
      processed: false,
      calculatedAt: { $lte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // 24 hours old
    }).limit(1000);

    for (const earning of pendingEarnings) {
      await earning.markAsProcessed();
    }

    logger.info(`Processed ${pendingEarnings.length} pending earnings`);
  } catch (error) {
    logger.error('Error processing pending earnings:', error);
  }
}