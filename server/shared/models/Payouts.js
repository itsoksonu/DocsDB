import mongoose from 'mongoose';

const payoutsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: [50, 'Minimum payout amount is $50']
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  method: {
    type: String,
    enum: ['stripe', 'paypal', 'bank_transfer'],
    default: 'stripe'
  },
  transactionId: {
    type: String,
    index: true
  },
  failureReason: String,
  estimatedArrival: Date,
  processedAt: Date,
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true
});

// Indexes for performance
payoutsSchema.index({ userId: 1, createdAt: -1 });
payoutsSchema.index({ status: 1, createdAt: -1 });
payoutsSchema.index({ method: 1, createdAt: -1 });

// Static method to get total payouts for a user
payoutsSchema.statics.getTotalPayouts = function(userId) {
  return this.aggregate([
    { 
      $match: { 
        userId: new mongoose.Types.ObjectId(userId),
        status: { $in: ['completed', 'processing'] }
      } 
    },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]).then(results => results[0]?.total || 0);
};

// Instance method to complete payout
payoutsSchema.methods.complete = function(transactionId = null) {
  this.status = 'completed';
  this.processedAt = new Date();
  if (transactionId) {
    this.transactionId = transactionId;
  }
  return this.save();
};

// Instance method to mark as failed
payoutsSchema.methods.fail = function(reason) {
  this.status = 'failed';
  this.failureReason = reason;
  return this.save();
};

export default mongoose.model('Payouts', payoutsSchema);