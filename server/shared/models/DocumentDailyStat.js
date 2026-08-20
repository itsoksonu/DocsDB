import mongoose from "mongoose";

// One row per document per UTC day. Written by the counter flusher, read by the
// admin insights view. Keeps the lifetime totals on Document authoritative
// while still giving a real time series instead of made-up numbers.
const documentDailyStatSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    views: {
      type: Number,
      default: 0,
    },
    downloads: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: false,
  }
);

documentDailyStatSchema.index({ documentId: 1, date: -1 }, { unique: true });
// Platform-wide "views per day" charts.
documentDailyStatSchema.index({ date: -1 });

export function utcDay(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export default mongoose.model("DocumentDailyStat", documentDailyStatSchema);
