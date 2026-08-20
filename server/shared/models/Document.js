import mongoose from 'mongoose';

// Single source of truth for the category enum, so the AI metadata normalizer
// and the admin validator cannot drift apart from the schema.
export const DOCUMENT_CATEGORIES = ["for-you","technology","business","education","health","entertainment","sports","finance-money-management","games-activities","comics","philosophy","career-growth","politics","biography-memoir","study-aids-test-prep","law","art","science","history","erotica","lifestyle","religion-spirituality","self-improvement","language-arts","cooking-food-wine","true-crime","sheet-music","fiction","non-fiction","science-fiction","fantasy","romance","thriller-suspense","horror","poetry","graphic-novels","young-adult","children","parenting-family","marketing-sales","psychology","social-sciences","engineering","mathematics", "data-science", "nature-environment","travel","reference","design", "news-media", "professional-development", "other"];

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
    // Public URL identifier: "<title-slug>-<6 hex chars>". The suffix makes it
    // unique without needing collision retries, and keeps the URL stable when
    // the title is edited (the slug is only generated once).
    slug: {
      type: String,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
    enum: ['uploaded', 'processing', 'processed', 'failed', 'quarantined', 'rejected', 'deleted', 'duplicate'],
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
    enum: DOCUMENT_CATEGORIES,
    default: 'other',
    index: true
    },
    embeddingsId: String,
    embedding: {
      type: [Number],
      select: false,
    },
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
    // Processing timeline, surfaced in the admin insights view and used to cap
    // manual reprocess requests.
    processingStartedAt: Date,
    processedAt: Date,
    retryCount: {
      type: Number,
      default: 0,
    },
    virusScanResult: {
      clean: Boolean,
      scanner: String,
    scannedAt: Date
    },
    // Automated fetcher provenance (set when a document is ingested by the
    // Document Fetcher rather than uploaded by a user).
    sourceUrl: String,
    sourceName: String, // e.g. "gutenberg", "arxiv", "pubmed", "archive", "openstax"
    sourceId: String, // the external ID from the source
    license: String, // e.g. "public domain", "CC BY 4.0"
    fileHash: String, // SHA-256 of the file bytes
    // Set when this user had already uploaded these exact bytes. The document
    // is kept as a tombstone pointing at the original rather than silently
    // vanishing, so the uploader can see what happened.
    duplicateOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
    },
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true
});

// indexes
// Sparse so documents that predate slug generation do not collide on null.
documentSchema.index({ slug: 1 }, { unique: true, sparse: true });
documentSchema.index({ userId: 1, createdAt: -1 });
documentSchema.index({ status: 1, createdAt: -1 });
documentSchema.index({ category: 1, createdAt: -1 });
documentSchema.index({ tags: 1 });
// Popular / trending feeds sort on these. Without the index Mongo has to load
// and sort every processed public document in memory on each request.
documentSchema.index({ status: 1, visibility: 1, viewsCount: -1 });
documentSchema.index({ status: 1, visibility: 1, downloadsCount: -1 });
// Deliberately NOT unique. Every document is hashed now, and two users are
// allowed to each hold their own document for the same file - they share one
// S3 object via StoredFile instead. A unique index here would throw E11000 at
// save time and discard the whole processing run, the same way the category
// enum used to. The fetcher checks for an existing hash explicitly before
// inserting, so it never relied on the constraint.
documentSchema.index({ fileHash: 1 });
// "Has this user already uploaded this exact file?"
documentSchema.index({ userId: 1, fileHash: 1 });
// Lookup by source provenance for de-duplication against previously fetched docs.
documentSchema.index({ sourceName: 1, sourceId: 1 });
documentSchema.index({
  'generatedTitle': 'text', 
  'generatedDescription': 'text',
  'tags': 'text'
});

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