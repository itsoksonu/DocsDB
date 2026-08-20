import logger from "./logger.js";

/**
 * Lists the models each provider will actually accept, straight from the
 * vendor.
 *
 * A hand-maintained list is exactly what caused the outage this replaces: the
 * code named models that had been retired and nobody noticed until every
 * document started getting a title scraped off page one. Asking the vendor is
 * the only listing that cannot go stale.
 */

const REQUEST_TIMEOUT_MS = 15_000;

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        body?.error?.message || body?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function listGeminiModels() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const body = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`
  );

  const models = body?.models || [];

  // The same endpoint lists generation and embedding models; the supported
  // method is what separates them.
  const text = models
    .filter((model) =>
      model.supportedGenerationMethods?.includes("generateContent")
    )
    .map((model) => ({
      id: model.name.replace(/^models\//, ""),
      label: model.displayName || model.name,
      description: model.description,
    }));

  const embedding = models
    .filter((model) => model.supportedGenerationMethods?.includes("embedContent"))
    .map((model) => ({
      id: model.name.replace(/^models\//, ""),
      label: model.displayName || model.name,
      description: model.description,
    }));

  return { text, embedding };
}

async function listGroqModels() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");

  const body = await fetchJson("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });

  const text = (body?.data || [])
    // Whisper and guard models cannot do the metadata task.
    .filter((model) => !/whisper|tts|guard|prompt-?guard/i.test(model.id))
    .map((model) => ({
      id: model.id,
      label: model.id,
      description: model.owned_by ? `by ${model.owned_by}` : undefined,
    }));

  return { text, embedding: [] };
}

async function listOllamaModels() {
  const url = process.env.OLLAMA_URL || "http://localhost:11434";
  const body = await fetchJson(`${url}/api/tags`);

  const text = (body?.models || []).map((model) => ({
    id: model.name,
    label: model.name,
    description: model.details?.parameter_size,
  }));

  return { text, embedding: [] };
}

/**
 * Hugging Face has no endpoint for "models this token can run on the provider
 * it will auto-select", so this is a warm-started list rather than a live one:
 * models the hub reports as served for the conversational task. The UI also
 * accepts a typed model id, and Test is the real check.
 */
async function listHuggingFaceModels() {
  const body = await fetchJson(
    "https://huggingface.co/api/models?pipeline_tag=text-generation&inference_provider=all&sort=trendingScore&limit=40",
    process.env.HUGGINGFACE_TOKEN
      ? { headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_TOKEN}` } }
      : {}
  );

  const text = (Array.isArray(body) ? body : []).map((model) => ({
    id: model.id || model.modelId,
    label: model.id || model.modelId,
    description: model.pipeline_tag,
  }));

  return { text, embedding: [] };
}

const LISTERS = {
  gemini: listGeminiModels,
  groq: listGroqModels,
  huggingface: listHuggingFaceModels,
  ollama: listOllamaModels,
};

/**
 * Returns every provider's models. One provider being down never fails the
 * whole call - the admin page shows the error next to that provider and its
 * dropdown falls back to free-text entry.
 */
export async function listAllModels() {
  const entries = await Promise.all(
    Object.entries(LISTERS).map(async ([provider, list]) => {
      try {
        const { text, embedding } = await list();
        return [provider, { ok: true, text, embedding }];
      } catch (error) {
        logger.warn(`Could not list ${provider} models: ${error.message}`);
        return [
          provider,
          { ok: false, error: error.message, text: [], embedding: [] },
        ];
      }
    })
  );

  return Object.fromEntries(entries);
}
