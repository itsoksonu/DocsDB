import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  reporterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reporterIp: String,
  reporterUserAgent: String,
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document'
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  type: {
    type: String,
    enum: ['copyright', 'spam', 'inappropriate', 'harassment', 'fraud', 'other'],
    required: true
  },
  category: {
    type: String,
    enum: ['upload', 'user', 'content', 'dmca', 'system'],
    default: 'content'
  },
  reason: {
    type: String,
    required: true,
    maxlength: 1000
  },
  evidence: [String],
  status: {
    type: String,
    enum: ['pending', 'under_review', 'approved', 'rejected', 'escalated'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  moderatorNotes: String,
  actionsTaken: [{
    action: String,
    timestamp: Date,
    moderatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    details: mongoose.Schema.Types.Mixed
  }],
  resolvedAt: Date,
  resolution: String,
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true
});

// Indexes
reportSchema.index({ status: 1, priority: -1, createdAt: -1 });
reportSchema.index({ documentId: 1, status: 1 });
reportSchema.index({ targetUserId: 1, status: 1 });
reportSchema.index({ reporterId: 1, createdAt: -1 });
reportSchema.index({ type: 1, status: 1 });

// Static method to get reports by status
reportSchema.statics.getByStatus = function(status, limit = 50) {
  return this.find({ status })
    .populate('reporterId', 'name email')
    .populate('documentId', 'generatedTitle fileType')
    .populate('targetUserId', 'name email')
    .sort({ priority: -1, createdAt: -1 })
    .limit(limit);
};

// Instance method to add action
reportSchema.methods.addAction = function(action, moderatorId, details = {}) {
  this.actionsTaken.push({
    action,
    timestamp: new Date(),
    moderatorId,
    details
  });
  return this.save();
};

// Instance method to resolve report
reportSchema.methods.resolve = function(resolution, moderatorId) {
  this.status = 'resolved';
  this.resolvedAt = new Date();
  this.resolution = resolution;
  return this.addAction('resolved', moderatorId, { resolution });
};

export default mongoose.model('Report', reportSchema);