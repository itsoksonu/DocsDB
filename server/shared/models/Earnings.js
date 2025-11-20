import mongoose from 'mongoose';

const earningsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0.0001, 'Amount must be greater than 0']
  },
  type: {
    type: String,
    enum: ['ad_share', 'download', 'sponsored', 'referral'],
    required: true
  },
  eventId: {
    type: String,
    required: true,
    index: true
  },
  currency: {
    type: String,
    default: 'USD'
  },
  metadata: {
    cpm: Number, 
    sharePercentage: Number, 
    viewDuration: Number, 
    adType: String,
    country: String, 
    deviceType: String 
  },
  calculatedAt: {
    type: Date,
    default: Date.now
  },
  processed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// indexes
earningsSchema.index({ userId: 1, createdAt: -1 });
earningsSchema.index({ documentId: 1, createdAt: -1 });
earningsSchema.index({ type: 1, createdAt: -1 });
earningsSchema.index({ processed: 1, createdAt: -1 });

// Static method to get total earnings for a user
earningsSchema.statics.getTotalEarnings = function(userId, startDate = null, endDate = null) {
  const match = { userId, processed: true };
  
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }

  return this.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]).then(results => results[0]?.total || 0);
};

// Static method to get earnings by type
earningsSchema.statics.getEarningsByType = function(userId, startDate = null, endDate = null) {
  const match = { userId, processed: true };
  
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }

  return this.aggregate([
    { $match: match },
    { 
      $group: { 
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      } 
    },
    { $sort: { total: -1 } }
  ]);
};

// Instance method to mark as processed
earningsSchema.methods.markAsProcessed = function() {
  this.processed = true;
  return this.save();
};

export default mongoose.model('Earnings', earningsSchema);