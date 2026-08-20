import mongoose from "mongoose";

export const AI_PROVIDERS = ["gemini", "groq", "huggingface", "ollama"];

const providerSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: AI_PROVIDERS,
      required: true,
    },
    model: {
      type: String,
      trim: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    // Lower runs first. The chain used to be hardcoded Gemini -> Groq -> HF ->
    // Ollama, so demoting a slow or expensive provider meant editing code.
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

/**
 * Single configuration document for the metadata and embedding models.
 *
 * These lived as hardcoded strings, so each time a vendor retired a model the
 * pipeline started failing silently - falling back to local heuristics that
 * produce a title scraped off page one, which then becomes a permanent URL
 * slug. Making them editable turns a code deploy into a dropdown.
 */
const aiSettingsSchema = new mongoose.Schema(
  {
    // Enforces exactly one document; every read and write targets this key.
    singleton: {
      type: String,
      default: "ai",
      unique: true,
      immutable: true,
    },
    providers: [providerSchema],
    embeddingModel: {
      type: String,
      trim: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

export default mongoose.model("AiSettings", aiSettingsSchema);
