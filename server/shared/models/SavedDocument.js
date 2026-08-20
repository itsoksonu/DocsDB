import mongoose from "mongoose";

const savedDocumentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
    },
    collectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserCollection",
      default: null,
    },
    savedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// A document is saved at most once per user.
savedDocumentSchema.index({ userId: 1, documentId: 1 }, { unique: true });
// The saved-documents list is always "this user, newest first".
savedDocumentSchema.index({ userId: 1, savedAt: -1 });
// Filtering the list down to one collection.
savedDocumentSchema.index({ userId: 1, collectionId: 1, savedAt: -1 });
// "How many people saved this document" (admin insights).
savedDocumentSchema.index({ documentId: 1 });

export default mongoose.model("SavedDocument", savedDocumentSchema);
