import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [255, 'Name cannot exceed 255 characters']
  },
  authProviders: [{
    provider: {
      type: String,
      enum: ['google'],
      required: true
    },
    providerId: {
      type: String,
      required: true
    },
    accessToken: String,
    refreshToken: String,
    connectedAt: {
      type: Date,
      default: Date.now
    }
  }],
  walletBalance: {
    type: Number,
    default: 0,
    min: [0, 'Balance cannot be negative']
  },
  kycStatus: {
    type: String,
    enum: ['pending', 'verified', 'rejected', 'unverified'],
    default: 'unverified'
  },
  payoutDetails: {
    stripeAccountId: String,
    bankAccount: mongoose.Schema.Types.Mixed
  },
  role: {
    type: String,
    enum: ['user', 'creator', 'admin'],
    default: 'user'
  },
  preferences: {
    emailNotifications: { type: Boolean, default: true },
    monetizationEnabled: { type: Boolean, default: true }
  },
  lastLoginAt: Date,
  status: {
    type: String,
    enum: ['active', 'suspended', 'banned'],
    default: 'active'
  },
  statusReason: String,
  suspendedUntil: Date,
  avatar: String,
  savedDocuments: [{
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true
    },
    savedAt: {
      type: Date,
      default: Date.now
    }
  }],
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.authProviders;
      return ret;
    }
  }
});

// Indexes
userSchema.index({ createdAt: -1 });
userSchema.index({ kycStatus: 1 });
userSchema.index({ 'authProviders.provider': 1, 'authProviders.providerId': 1 });
userSchema.index({ 'savedDocuments.documentId': 1 });

// Method to add OAuth provider
userSchema.methods.addAuthProvider = async function(providerData) {
  const existingProvider = this.authProviders.find(
    p => p.provider === providerData.provider
  );
  
  if (existingProvider) {
    existingProvider.providerId = providerData.providerId;
    existingProvider.accessToken = providerData.accessToken;
    existingProvider.refreshToken = providerData.refreshToken;
    existingProvider.connectedAt = new Date();
  } else {
    this.authProviders.push(providerData);
  }
  
  return this.save();
};

// Static method to find user by OAuth provider
userSchema.statics.findByOAuthProvider = function(provider, providerId) {
  return this.findOne({
    'authProviders.provider': provider,
    'authProviders.providerId': providerId
  });
};

// Method to check if document is saved
userSchema.methods.hasSavedDocument = function(documentId) {
  return this.savedDocuments.some(
    savedDoc => savedDoc.documentId.toString() === documentId.toString()
  );
};

// Method to save a document
userSchema.methods.saveDocument = async function(documentId) {
  if (!this.hasSavedDocument(documentId)) {
    this.savedDocuments.push({ documentId });
    await this.save();
  }
  return this;
};

// Method to unsave a document
userSchema.methods.unsaveDocument = async function(documentId) {
  this.savedDocuments = this.savedDocuments.filter(
    savedDoc => savedDoc.documentId.toString() !== documentId.toString()
  );
  await this.save();
  return this;
};

export default mongoose.model('User', userSchema);