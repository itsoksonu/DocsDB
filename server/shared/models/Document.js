import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  originalFilename: {
    type: String,
    required: true,
    maxlength: 255
  },
  s3Path: {
    type: String,
    required: true
  },
  thumbnailS3Path: String,
  status: {
    type: String,
    enum: ['uploaded', 'processing', 'processed', 'failed', 'quarantined', 'rejected'],
    default: 'uploaded',
    index: true
  },
  fileType: {
    type: String,
    enum: ['pdf', 'docx', 'pptx', 'xlsx', 'csv'],
    required: true
  },
  sizeBytes: {
    type: Number,
    required: true,
    min: [1, 'File size must be at least 1 byte'],
    max: [104857600, 'File size cannot exceed 100MB']
  },
  pageCount: Number,
  generatedTitle: {
    type: String,
    maxlength: 255
  },
  generatedDescription: {
    type: String,
    maxlength: 500
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  category: {
    type: String,
    enum: ['technology', 'business', 'education', 'health', 'entertainment', 'other'],
    default: 'other',
    index: true
  },
  embeddingsId: String, // Pinecone vector ID
  visibility: {
    type: String,
    enum: ['public', 'private', 'unlisted'],
    default: 'public'
  },
  monetizationEnabled: {
    type: Boolean,
    default: true
  },
  revenueSharePercent: {
    type: Number,
    default: 70,
    min: 0,
    max: 100
  },
  viewsCount: {
    type: Number,
    default: 0
  },
  downloadsCount: {
    type: Number,
    default: 0
  },
  processingError: String,
  virusScanResult: {
    clean: Boolean,
    scanner: String,
    scannedAt: Date
  },
  metadata: mongoose.Schema.Types.Mixed // Additional AI-generated metadata
}, {
  timestamps: true
});

// Compound indexes for performance
documentSchema.index({ userId: 1, createdAt: -1 });
documentSchema.index({ status: 1, createdAt: -1 });
documentSchema.index({ category: 1, createdAt: -1 });
documentSchema.index({ tags: 1 }); // For tag-based searches
documentSchema.index({ 
  'generatedTitle': 'text', 
  'generatedDescription': 'text',
  'tags': 'text'
}); // Text search index

// Virtual for formatted file size
documentSchema.virtual('formattedSize').get(function() {
  const bytes = this.sizeBytes;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Byte';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
});

// Instance method to check if document is viewable
documentSchema.methods.isViewable = function() {
  return this.status === 'processed' && this.visibility === 'public';
};

// Static method to get popular documents
documentSchema.statics.getPopular = function(limit = 10) {
  return this.find({ 
    status: 'processed', 
    visibility: 'public' 
  })
  .sort({ viewsCount: -1 })
  .limit(limit)
  .populate('userId', 'name email');
};

export default mongoose.model('Document', documentSchema);