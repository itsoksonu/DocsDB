import mongoose from "mongoose";

// Identity and account state only. Everything that grows without bound or
// belongs to a different concern lives in its own collection:
//   authProviders   -> UserAuthProvider
//   wallet / KYC    -> UserWallet
//   collections     -> UserCollection
//   savedDocuments  -> SavedDocument
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [255, "Name cannot exceed 255 characters"],
    },
    role: {
      type: String,
      enum: ["user", "creator", "admin"],
      default: "user",
    },
    preferences: {
      emailNotifications: { type: Boolean, default: true },
      monetizationEnabled: { type: Boolean, default: true },
    },
    lastLoginAt: Date,
    status: {
      type: String,
      enum: ["active", "suspended", "banned"],
      default: "active",
    },
    statusReason: String,
    suspendedUntil: Date,
    avatar: String,
  },
  {
    timestamps: true,
    // Legacy documents still carry the pre-normalization fields until the
    // prune step runs. strict:true (the default) already keeps them out of
    // reads and writes through this model.
  }
);

// Indexes
userSchema.index({ createdAt: -1 });
userSchema.index({ role: 1, status: 1 });

export default mongoose.model("User", userSchema);
