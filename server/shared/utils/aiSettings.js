import AiSettings, { AI_PROVIDERS } from "../models/AiSettings.js";
import logger from "./logger.js";

/**
 * Resolved AI configuration: database first, then environment, then code.
 *
 * The env layer is kept so an existing deployment keeps working untouched and
 * so there is a way to recover if the database config is wrong. Anything set in
 * the admin panel wins.
 *
 * Defaults below are current as of August 2026:
 *   gemini-2.0-flash      retired
 *   llama-3.1-8b-instant  deprecated by Groq 2026-06-17
 *   text-embedding-004    shut down 2026-01-14
 */
const FALLBACK_MODELS = {
  gemini: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  groq: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
  huggingface:
    process.env.HUGGINGFACE_MODEL || "mistralai/Mistral-7B-Instruct-v0.3",
  ollama: process.env.OLLAMA_MODEL || "llama3",
};

const FALLBACK_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";

// The order the chain ran in before it was configurable.
const DEFAULT_ORDER = ["gemini", "groq", "huggingface", "ollama"];

// processDocument reads this per document, so it is cached. The TTL is a
// backstop for other instances; the instance that saves clears its own cache
// immediately.
const CACHE_TTL_MS = 60_000;

let cache = null;
let cachedAt = 0;

function buildDefaults() {
  return {
    providers: DEFAULT_ORDER.map((provider, index) => ({
      provider,
      model: FALLBACK_MODELS[provider],
      enabled: true,
      order: index,
    })),
    embeddingModel: FALLBACK_EMBEDDING_MODEL,
  };
}

function merge(stored) {
  const defaults = buildDefaults();
  if (!stored) return defaults;

  const byProvider = new Map(
    (stored.providers || []).map((entry) => [entry.provider, entry])
  );

  // Start from the defaults so a provider added to the code later shows up
  // without needing a database migration.
  const providers = AI_PROVIDERS.map((provider) => {
    const saved = byProvider.get(provider);
    const fallback = defaults.providers.find((p) => p.provider === provider);

    return {
      provider,
      model: saved?.model?.trim() || fallback.model,
      enabled: saved?.enabled ?? fallback.enabled,
      order: saved?.order ?? fallback.order,
    };
  }).sort((a, b) => a.order - b.order);

  return {
    providers,
    embeddingModel:
      stored.embeddingModel?.trim() || defaults.embeddingModel,
  };
}

export async function getAiSettings() {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cache;
  }

  try {
    const stored = await AiSettings.findOne({ singleton: "ai" }).lean();
    cache = merge(stored);
  } catch (error) {
    // Never let a settings read break processing - fall back to env/code.
    logger.error("Could not read AI settings, using defaults:", error);
    cache = buildDefaults();
  }

  cachedAt = Date.now();
  return cache;
}

export async function updateAiSettings({ providers, embeddingModel, updatedBy }) {
  const update = { updatedBy };

  if (providers) {
    update.providers = providers.map((entry, index) => ({
      provider: entry.provider,
      model: entry.model?.trim() || undefined,
      enabled: entry.enabled !== false,
      // Position in the submitted array is the fallback order, so the UI does
      // not have to invent order numbers.
      order: typeof entry.order === "number" ? entry.order : index,
    }));
  }

  if (embeddingModel !== undefined) {
    update.embeddingModel = embeddingModel?.trim() || undefined;
  }

  const saved = await AiSettings.findOneAndUpdate(
    { singleton: "ai" },
    { $set: update, $setOnInsert: { singleton: "ai" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  invalidateAiSettings();
  return merge(saved);
}

export function invalidateAiSettings() {
  cache = null;
  cachedAt = 0;
}

/** Providers that are switched on, in the configured fallback order. */
export async function getActiveProviders() {
  const { providers } = await getAiSettings();
  return providers.filter((provider) => provider.enabled);
}

export async function getEmbeddingModel() {
  const { embeddingModel } = await getAiSettings();
  return embeddingModel;
}

export { AI_PROVIDERS, FALLBACK_MODELS, FALLBACK_EMBEDDING_MODEL };
