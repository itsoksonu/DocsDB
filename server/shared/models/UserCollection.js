import mongoose from "mongoose";

const userCollectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
  },
  {
    timestamps: true,
  }
);

// Names are unique per user, case-insensitively (strength 2 ignores case/accents).
userCollectionSchema.index(
  { userId: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);
userCollectionSchema.index({ userId: 1, createdAt: 1 });

export default mongoose.model("UserCollection", userCollectionSchema);
