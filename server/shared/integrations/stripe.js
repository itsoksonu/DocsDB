import Stripe from 'stripe';
import logger from '../utils/logger.js';

// Initialize Stripe
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  maxNetworkRetries: 3,
  timeout: 10000
});

// Webhook handler for Stripe events
export async function handleStripeWebhook(event) {
  try {
    switch (event.type) {
      case 'account.updated':
        await handleAccountUpdated(event.data.object);
        break;
      
      case 'transfer.failed':
        await handleTransferFailed(event.data.object);
        break;
      
      case 'transfer.paid':
        await handleTransferPaid(event.data.object);
        break;
      
      case 'payout.paid':
        await handlePayoutPaid(event.data.object);
        break;

      default:
        logger.info(`Unhandled Stripe event type: ${event.type}`);
    }

    return { success: true };
  } catch (error) {
    logger.error('Error handling Stripe webhook:', error);
    throw error;
  }
}

async function handleAccountUpdated(account) {
  try {
    // Find user by Stripe account ID
    const User = (await import('../models/User.js')).default;
    const user = await User.findOne({ 
      'payoutDetails.stripeAccountId': account.id 
    });

    if (!user) {
      logger.warn(`No user found for Stripe account: ${account.id}`);
      return;
    }

    // Update KYC status based on Stripe account status
    const isVerified = account.charges_enabled && account.payouts_enabled;
    user.kycStatus = isVerified ? 'verified' : 'pending';
    
    await user.save();

    logger.info(`Updated KYC status for user ${user._id}: ${user.kycStatus}`);
  } catch (error) {
    logger.error('Error handling account.updated:', error);
  }
}

async function handleTransferFailed(transfer) {
  try {
    const Payouts = (await import('../models/Payouts.js')).default;
    
    // Find payout by transaction ID
    const payout = await Payouts.findOne({ transactionId: transfer.id });
    if (payout) {
      await payout.fail(`Transfer failed: ${transfer.failure_message}`);
      logger.info(`Marked payout ${payout._id} as failed`);
    }
  } catch (error) {
    logger.error('Error handling transfer.failed:', error);
  }
}

async function handleTransferPaid(transfer) {
  try {
    const Payouts = (await import('../models/Payouts.js')).default;
    
    const payout = await Payouts.findOne({ transactionId: transfer.id });
    if (payout) {
      await payout.complete();
      logger.info(`Marked payout ${payout._id} as completed`);
    }
  } catch (error) {
    logger.error('Error handling transfer.paid:', error);
  }
}

async function handlePayoutPaid(payout) {
  // Handle successful payouts
  logger.info(`Payout completed: ${payout.id}`);
}

// Verify webhook signature
export function verifyWebhookSignature(payload, signature) {
  try {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    logger.error('Webhook signature verification failed:', error);
    throw error;
  }
}