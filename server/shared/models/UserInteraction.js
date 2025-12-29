import mongoose from "mongoose";

const userInteractionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
    },
    type: {
      type: String,
      enum: ["hidden", "more_like_this"],
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 30, // Optional: auto-expire interactions after 30 days to keep data fresh and manageable
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to prevent duplicate interactions of same type
userInteractionSchema.index(
  { userId: 1, documentId: 1, type: 1 },
  { unique: true }
);

// Index for efficient querying by type (e.g., "get all hidden docs for user")
userInteractionSchema.index({ userId: 1, type: 1 });

export default mongoose.model("UserInteraction", userInteractionSchema);
