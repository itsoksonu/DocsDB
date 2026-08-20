import mongoose from "mongoose";

const userWalletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: [0, "Balance cannot be negative"],
    },
    kycStatus: {
      type: String,
      enum: ["pending", "verified", "rejected", "unverified"],
      default: "unverified",
      index: true,
    },
    payoutDetails: {
      stripeAccountId: String,
      bankAccount: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Stripe webhooks look a wallet up by connected account id.
userWalletSchema.index(
  { "payoutDetails.stripeAccountId": 1 },
  { unique: true, sparse: true }
);

// Wallets are created lazily, so every read path needs a safe accessor.
userWalletSchema.statics.getOrCreate = async function (userId) {
  return this.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

export default mongoose.model("UserWallet", userWalletSchema);
