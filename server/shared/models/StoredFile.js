import mongoose from "mongoose";

/**
 * One row per distinct set of bytes in S3.
 *
 * Documents keep their own s3Path, but several documents can point at the same
 * key. This is what makes that safe: DELETE used to call
 * S3Manager.deleteObject(document.s3Path) unconditionally, which with shared
 * storage would destroy a file another user's document still references.
 * Nothing is removed from S3 until refCount reaches zero.
 */
const storedFileSchema = new mongoose.Schema(
  {
    hash: {
      type: String,
      required: true,
      unique: true,
    },
    s3Path: {
      type: String,
      required: true,
    },
    sizeBytes: {
      type: Number,
      default: 0,
    },
    refCount: {
      type: Number,
      default: 1,
      min: 0,
    },
  },
  { timestamps: true }
);

// Finding the rows whose object is now unreferenced.
storedFileSchema.index({ refCount: 1 });

export default mongoose.model("StoredFile", storedFileSchema);
