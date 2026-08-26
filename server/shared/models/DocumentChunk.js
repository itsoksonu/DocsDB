import mongoose from "mongoose";

/**
 * One retrievable passage of a document, with its embedding.
 *
 * The Document's own `embedding` is a single vector for the whole file, built
 * from the title plus the first 8k characters. That is right for "find me
 * similar documents" and useless for "what does page 300 say": a question can
 * only be answered from text that was actually sent to the model, and a long
 * document does not fit. These chunks are what makes retrieval possible.
 *
 * Built lazily, the first time somebody asks a question about the document, so
 * no backfill is needed and files nobody asks about cost nothing.
 */
const documentChunkSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
    },
    // Position in the document. Ordering by this reassembles reading order.
    index: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    // Where this passage came from, when the file format actually says so:
    // "Page 12", "Slide 4", "Sheet: Q3". Absent for formats with no such
    // structure (docx, csv) - an invented page number is worse than none.
    label: String,
    // Float32 binary, not an array of numbers.
    //
    // A BSON array spends a type byte and an index key ("0", "1", ... "3071")
    // on every element on top of an 8-byte double, so one 3072-dimension vector
    // costs roughly 40 KB on the wire. The same vector as Float32 binary is
    // 12 KB. Loading a 36-passage document was transferring 1.4 MB and parsing
    // it into 110,000 JS numbers, which took four to five seconds against
    // Atlas. Nothing is lost: similarity was already computed in Float32.
    //
    // Written and read by encodeVector/decodeVector in documentIndex.js.
    // Excluded by default so a read that only needs the text does not carry it.
    embedding: {
      type: Buffer,
      select: false,
    },
  },
  { timestamps: true },
);

// Reassembling a document, and the duplicate-key guard that makes two
// simultaneous first questions safe (one insert wins, the other reads).
documentChunkSchema.index({ documentId: 1, index: 1 }, { unique: true });

export default mongoose.model("DocumentChunk", documentChunkSchema);
