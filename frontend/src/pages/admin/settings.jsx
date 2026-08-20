import { useState, useEffect, useCallback } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { apiService } from "../../services/api";
import {
  Sparkles,
  Check,
  AlertTriangle,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Save,
  Layers,
} from "../../icons";
import toast from "react-hot-toast";

const PROVIDER_LABELS = {
  gemini: "Google Gemini",
  groq: "Groq",
  huggingface: "Hugging Face",
  ollama: "Ollama (self-hosted)",
};

const PROVIDER_NOTES = {
  gemini: "Also provides the embedding model below.",
  groq: "Fast and cheap; good as the first fallback.",
  huggingface:
    "The hub list is not a guarantee your token can run a model — use Test.",
  ollama: "Only reachable if you run Ollama next to the server.",
};

function StatusPill({ state }) {
  if (!state) return null;

  if (state.testing) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-400">
        <RefreshCw size={12} className="animate-spin" />
        Testing…
      </span>
    );
  }

  return state.ok ? (
    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
      <Check size={12} />
      Working{state.latencyMs ? ` · ${state.latencyMs}ms` : ""}
    </span>
  ) : (
    <span
      className="flex items-center gap-1.5 text-xs text-red-400 max-w-md"
      title={state.reason}
    >
      <AlertTriangle size={12} className="flex-shrink-0" />
      <span className="truncate">{state.reason || "Failed"}</span>
    </span>
  );
}

/**
 * A dropdown of models the vendor actually reports, with free-text as an
 * escape hatch. A hand-maintained list is exactly what broke before: the code
 * named models that had been retired and the pipeline silently degraded.
 */
function ModelPicker({ value, options, catalogError, onChange, disabled }) {
  const [custom, setCustom] = useState(false);

  const known = options.some((option) => option.id === value);
  const useCustom = custom || (!known && value);

  if (useCustom || catalogError) {
    return (
      <div className="space-y-1">
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="model id"
          className="w-full bg-dark-950 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        {catalogError ? (
          <p className="text-xs text-amber-400/80">
            Could not list models: {catalogError}
          </p>
        ) : (
          <button
            onClick={() => setCustom(false)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Choose from list instead
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-dark-950 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
      >
        <option value="">Select a model…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => setCustom(true)}
        className="text-xs text-blue-400 hover:text-blue-300"
      >
        Enter a model id manually
      </button>
    </div>
  );
}

export default function AiSettingsPage() {
  const [providers, setProviders] = useState([]);
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [catalog, setCatalog] = useState({});
  const [credentials, setCredentials] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tests, setTests] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiService.getAiSettings();
      setProviders(response.data.providers);
      setEmbeddingModel(response.data.embeddingModel);
      setCatalog(response.data.catalog || {});
      setCredentials(response.data.credentials || {});
      setDirty(false);
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Failed to load AI settings"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateProvider = (name, changes) => {
    setProviders((previous) =>
      previous.map((entry) =>
        entry.provider === name ? { ...entry, ...changes } : entry
      )
    );
    setDirty(true);
  };

  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= providers.length) return;

    const next = [...providers];
    [next[index], next[target]] = [next[target], next[index]];
    setProviders(next.map((entry, i) => ({ ...entry, order: i })));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await apiService.updateAiSettings({
        providers: providers.map((entry, index) => ({
          provider: entry.provider,
          model: entry.model,
          enabled: entry.enabled,
          order: index,
        })),
        embeddingModel,
      });
      setProviders(response.data.providers);
      setEmbeddingModel(response.data.embeddingModel);
      setDirty(false);
      toast.success("AI settings saved");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const test = async (provider, model) => {
    setTests((previous) => ({ ...previous, [provider]: { testing: true } }));
    try {
      const response = await apiService.testAiProvider(provider, model);
      setTests((previous) => ({ ...previous, [provider]: response.data }));
    } catch (error) {
      setTests((previous) => ({
        ...previous,
        [provider]: {
          ok: false,
          reason: error.response?.data?.message || "Request failed",
        },
      }));
    }
  };

  const testAll = async () => {
    const names = [...providers.map((p) => p.provider), "embedding"];
    setTests(
      Object.fromEntries(names.map((name) => [name, { testing: true }]))
    );

    try {
      const response = await apiService.testAllAiProviders();
      const next = {};
      for (const result of response.data.results) {
        next[result.provider] = result;
      }
      next.embedding = response.data.embedding;
      setTests(next);
    } catch (error) {
      toast.error(error.response?.data?.message || "Test run failed");
      setTests({});
    }
  };

  const anyEnabledWorking = providers
    .filter((entry) => entry.enabled)
    .some((entry) => tests[entry.provider]?.ok);

  const testedAnyEnabled = providers
    .filter((entry) => entry.enabled)
    .some((entry) => tests[entry.provider] && !tests[entry.provider].testing);

  if (loading) {
    return (
      <AdminLayout>
        <div className="py-20 text-center text-dark-500">Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">AI Settings</h1>
            <p className="text-dark-400">
              Which models generate document titles, descriptions and tags
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={testAll}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-lg transition-colors"
            >
              <Sparkles size={15} /> Test all
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save size={15} />
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        {/* Why this page exists */}
        <div className="flex items-start gap-3 bg-dark-900 border border-dark-800 rounded-xl p-4">
          <Layers size={18} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-dark-300 leading-relaxed">
            Providers are tried top to bottom until one answers. If they all
            fail, processing does not error — it falls back to local heuristics
            that guess a title from the first page, and that title becomes the
            document&apos;s permanent URL. Keep at least one provider working.
          </p>
        </div>

        {testedAnyEnabled && !anyEnabledWorking && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <AlertTriangle
              size={18}
              className="text-red-400 flex-shrink-0 mt-0.5"
            />
            <p className="text-sm text-red-300">
              No enabled provider is responding. New uploads will get
              heuristic titles until this is fixed.
            </p>
          </div>
        )}

        {/* Providers */}
        <div className="space-y-3">
          {providers.map((entry, index) => {
            const providerCatalog = catalog[entry.provider] || {};
            const hasKey = credentials[entry.provider];

            return (
              <div
                key={entry.provider}
                className={`bg-dark-900 border rounded-xl p-4 transition-colors ${
                  entry.enabled ? "border-dark-800" : "border-dark-800/50 opacity-60"
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  {/* Order controls */}
                  <div className="flex lg:flex-col items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="p-1 text-dark-400 hover:text-white hover:bg-dark-800 rounded disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      aria-label="Move up"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <span className="text-xs text-dark-500 tabular-nums w-4 text-center">
                      {index + 1}
                    </span>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === providers.length - 1}
                      className="p-1 text-dark-400 hover:text-white hover:bg-dark-800 rounded disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      aria-label="Move down"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>

                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-medium text-white">
                        {PROVIDER_LABELS[entry.provider]}
                      </h2>

                      <label className="flex items-center gap-2 text-xs text-dark-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={entry.enabled}
                          onChange={(e) =>
                            updateProvider(entry.provider, {
                              enabled: e.target.checked,
                            })
                          }
                          className="accent-blue-500"
                        />
                        Enabled
                      </label>

                      {!hasKey && (
                        <span className="text-xs text-amber-400">
                          No API key configured
                        </span>
                      )}

                      <div className="ml-auto">
                        <StatusPill state={tests[entry.provider]} />
                      </div>
                    </div>

                    <p className="text-xs text-dark-500">
                      {PROVIDER_NOTES[entry.provider]}
                    </p>

                    <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
                      <div className="flex-1">
                        <ModelPicker
                          value={entry.model}
                          options={providerCatalog.text || []}
                          catalogError={
                            providerCatalog.ok === false
                              ? providerCatalog.error
                              : null
                          }
                          onChange={(model) =>
                            updateProvider(entry.provider, { model })
                          }
                          disabled={!entry.enabled}
                        />
                      </div>
                      <button
                        onClick={() => test(entry.provider, entry.model)}
                        disabled={!entry.model}
                        className="px-3 py-2 text-sm bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-lg transition-colors disabled:opacity-40 flex-shrink-0"
                      >
                        Test
                      </button>
                    </div>

                    {tests[entry.provider]?.sample?.title && (
                      <p className="text-xs text-dark-400">
                        Sample title:{" "}
                        <span className="text-dark-200">
                          {tests[entry.provider].sample.title}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Embeddings */}
        <div className="bg-dark-900 border border-dark-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-medium text-white">Embedding model</h2>
            <div className="ml-auto">
              <StatusPill state={tests.embedding} />
            </div>
          </div>
          <p className="text-xs text-dark-500">
            Used for related-document matching. Failures here are logged and
            ignored, so a retired model goes unnoticed until search quality
            drops.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
            <div className="flex-1">
              <ModelPicker
                value={embeddingModel}
                options={catalog.gemini?.embedding || []}
                catalogError={
                  catalog.gemini?.ok === false ? catalog.gemini.error : null
                }
                onChange={(model) => {
                  setEmbeddingModel(model);
                  setDirty(true);
                }}
              />
            </div>
            <button
              onClick={() => test("embedding", embeddingModel)}
              disabled={!embeddingModel}
              className="px-3 py-2 text-sm bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-lg transition-colors disabled:opacity-40 flex-shrink-0"
            >
              Test
            </button>
          </div>
          {tests.embedding?.dimensions > 0 && (
            <p className="text-xs text-dark-400">
              Returned {tests.embedding.dimensions} dimensions
            </p>
          )}
        </div>

        <p className="text-xs text-dark-500">
          Saved settings override the values in <code>.env</code>. If nothing is
          saved, the environment variables apply, then the built-in defaults.
        </p>
      </div>
    </AdminLayout>
  );
}
