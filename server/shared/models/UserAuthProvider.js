import mongoose from "mongoose";

const userAuthProviderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["google"],
      required: true,
    },
    providerId: {
      type: String,
      required: true,
    },
    accessToken: String,
    refreshToken: String,
    connectedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete ret.accessToken;
        delete ret.refreshToken;
        return ret;
      },
    },
  }
);

// A given external identity maps to exactly one row.
userAuthProviderSchema.index({ provider: 1, providerId: 1 }, { unique: true });
// A user connects each provider at most once.
userAuthProviderSchema.index({ userId: 1, provider: 1 }, { unique: true });

// Find the user id behind an external identity.
userAuthProviderSchema.statics.findByProvider = function (provider, providerId) {
  return this.findOne({ provider, providerId });
};

// Connect or refresh a provider for a user. Replaces User#addAuthProvider.
userAuthProviderSchema.statics.connect = function (userId, providerData) {
  const { provider, providerId, accessToken, refreshToken } = providerData;

  return this.findOneAndUpdate(
    { userId, provider },
    {
      $set: {
        providerId,
        accessToken,
        refreshToken,
        connectedAt: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

export default mongoose.model("UserAuthProvider", userAuthProviderSchema);
