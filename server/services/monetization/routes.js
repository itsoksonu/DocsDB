import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';
import User from '../../shared/models/User.js';
import Document from '../../shared/models/Document.js';
import Earnings from '../../shared/models/Earnings.js';
import Payouts from '../../shared/models/Payouts.js';
import { 
  calculateEarnings, 
  trackMonetizationEvent,
  processPayout,
  getEarningsSummary 
} from '../../shared/utils/monetizationEngine.js';
import { stripe } from '../../shared/integrations/stripe.js';
import logger from '../../shared/utils/logger.js';

const router = express.Router();

// Get user earnings summary
router.get('/earnings',
  authMiddleware,
  [
    query('timeframe').optional().isIn(['today', 'week', 'month', 'year', 'all']).default('month'),
    query('page').optional().isInt({ min: 1 }).default(1),
    query('limit').optional().isInt({ min: 1, max: 100 }).default(50)
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { timeframe, page, limit } = req.query;
      const userId = req.user.userId;

      const earningsSummary = await getEarningsSummary(userId, timeframe, parseInt(page), parseInt(limit));

      res.json({
        success: true,
        data: earningsSummary
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get payout history
router.get('/payouts',
  authMiddleware,
  [
    query('page').optional().isInt({ min: 1 }).default(1),
    query('limit').optional().isInt({ min: 1, max: 50 }).default(20)
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { page, limit } = req.query;
      const userId = req.user.userId;
      const skip = (page - 1) * limit;

      const [payouts, total] = await Promise.all([
        Payouts.find({ userId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Payouts.countDocuments({ userId })
      ]);

      res.json({
        success: true,
        data: {
          payouts,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            hasMore: (skip + payouts.length) < total
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Request payout
router.post('/payouts/request',
  authMiddleware,
  [
    body('amount').isFloat({ min: 50, max: 10000 }).withMessage('Amount must be between $50 and $10,000')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { amount } = req.body;
      const userId = req.user.userId;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (user.walletBalance < amount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient balance for payout'
        });
      }

      if (user.kycStatus !== 'verified') {
        return res.status(400).json({
          success: false,
          message: 'KYC verification required before requesting payouts'
        });
      }

      if (amount < 50) {
        return res.status(400).json({
          success: false,
          message: 'Minimum payout amount is $50'
        });
      }

      const payoutResult = await processPayout(userId, amount);

      if (!payoutResult.success) {
        return res.status(400).json({
          success: false,
          message: payoutResult.message
        });
      }

      res.json({
        success: true,
        message: 'Payout requested successfully',
        data: {
          payoutId: payoutResult.payoutId,
          amount: payoutResult.amount,
          estimatedArrival: payoutResult.estimatedArrival
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get monetization settings
router.get('/settings',
  authMiddleware,
  async (req, res, next) => {
    try {
      const userId = req.user.userId;

      const user = await User.findById(userId).select('payoutDetails monetizationEnabled walletBalance kycStatus');
      const documents = await Document.find({ userId, monetizationEnabled: true }).countDocuments();

      const settings = {
        monetizationEnabled: user.monetizationEnabled,
        walletBalance: user.walletBalance,
        kycStatus: user.kycStatus,
        payoutDetails: user.payoutDetails,
        monetizedDocuments: documents,
        minimumPayout: 50,
        payoutFeePercentage: 2.9,
        revenueShare: 70
      };

      res.json({
        success: true,
        data: settings
      });

    } catch (error) {
      next(error);
    }
  }
);

// Update monetization settings
router.patch('/settings',
  authMiddleware,
  [
    body('monetizationEnabled').optional().isBoolean()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { monetizationEnabled } = req.body;
      const userId = req.user.userId;

      const updateData = {};
      if (monetizationEnabled !== undefined) {
        updateData.monetizationEnabled = monetizationEnabled;
      }

      await User.findByIdAndUpdate(userId, { $set: updateData });

      res.json({
        success: true,
        message: 'Settings updated successfully'
      });

    } catch (error) {
      next(error);
    }
  }
);

// Stripe Connect onboarding
router.post('/onboarding',
  authMiddleware,
  async (req, res, next) => {
    try {
      const userId = req.user.userId;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: user.email,
        capabilities: {
          transfers: { requested: true },
        },
        metadata: {
          userId: userId.toString()
        }
      });

      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${process.env.FRONTEND_URL}/monetization/onboarding/refresh`,
        return_url: `${process.env.FRONTEND_URL}/monetization/onboarding/success`,
        type: 'account_onboarding',
      });

      await User.findByIdAndUpdate(userId, {
        $set: {
          'payoutDetails.stripeAccountId': account.id
        }
      });

      res.json({
        success: true,
        data: {
          onboardingUrl: accountLink.url,
          stripeAccountId: account.id
        }
      });

    } catch (error) {
      logger.error('Stripe onboarding error:', error);
      next(error);
    }
  }
);

// Check KYC status
router.get('/kyc-status',
  authMiddleware,
  async (req, res, next) => {
    try {
      const userId = req.user.userId;
      const user = await User.findById(userId).select('kycStatus payoutDetails');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      let stripeStatus = null;
      if (user.payoutDetails?.stripeAccountId) {
        try {
          const account = await stripe.accounts.retrieve(user.payoutDetails.stripeAccountId);
          stripeStatus = account.charges_enabled && account.payouts_enabled;
        } catch (error) {
          logger.error('Error checking Stripe account status:', error);
        }
      }

      res.json({
        success: true,
        data: {
          kycStatus: user.kycStatus,
          stripeVerified: stripeStatus,
          requirements: getKYCRequirements(user.kycStatus, stripeStatus)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Admin routes for payout management
router.get('/admin/payouts',
  authMiddleware,
  requireRole(['admin']),
  [
    query('status').optional().isIn(['pending', 'processing', 'completed', 'failed']),
    query('page').optional().isInt({ min: 1 }).default(1),
    query('limit').optional().isInt({ min: 1, max: 100 }).default(50)
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { status, page, limit } = req.query;
      const skip = (page - 1) * limit;

      const query = {};
      if (status) {
        query.status = status;
      }

      const [payouts, total] = await Promise.all([
        Payouts.find(query)
          .populate('userId', 'name email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Payouts.countDocuments(query)
      ]);

      res.json({
        success: true,
        data: {
          payouts,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            hasMore: (skip + payouts.length) < total
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Process payout (admin)
router.post('/admin/payouts/:payoutId/process',
  authMiddleware,
  requireRole(['admin']),
  [
    param('payoutId').isMongoId()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payout ID'
        });
      }

      const { payoutId } = req.params;

      const payout = await Payouts.findById(payoutId).populate('userId');
      if (!payout) {
        return res.status(404).json({
          success: false,
          message: 'Payout not found'
        });
      }

      if (payout.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'Payout already processed'
        });
      }

      try {
        const transfer = await stripe.transfers.create({
          amount: Math.round(payout.amount * 100), // Convert to cents
          currency: 'usd',
          destination: payout.userId.payoutDetails.stripeAccountId,
          metadata: {
            payoutId: payout._id.toString(),
            userId: payout.userId._id.toString()
          }
        });

        payout.status = 'processing';
        payout.transactionId = transfer.id;
        await payout.save();

        res.json({
          success: true,
          message: 'Payout processing started',
          data: { payout }
        });

      } catch (stripeError) {
        logger.error('Stripe transfer error:', stripeError);
        
        payout.status = 'failed';
        payout.failureReason = stripeError.message;
        await payout.save();

        return res.status(400).json({
          success: false,
          message: `Payout failed: ${stripeError.message}`
        });
      }

    } catch (error) {
      next(error);
    }
  }
);

// Helper functions
function getKYCRequirements(kycStatus, stripeStatus) {
  const requirements = [];

  if (kycStatus !== 'verified') {
    requirements.push({
      type: 'identity_verification',
      status: 'pending',
      description: 'Verify your identity'
    });
  }

  if (!stripeStatus) {
    requirements.push({
      type: 'stripe_onboarding',
      status: 'pending',
      description: 'Complete Stripe onboarding'
    });
  }

  if (requirements.length === 0) {
    requirements.push({
      type: 'complete',
      status: 'completed',
      description: 'All requirements completed'
    });
  }

  return requirements;
}

export default router;