import { useState, useEffect, useRef } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { apiService } from "../../services/api";
import { DownloadCloud, Loader2, CheckCircle2, XCircle, SkipForward } from "lucide-react";
import toast from "react-hot-toast";

// Mirrors the category enum used in documents.jsx / the Document schema.
const categories = [
  { value: "science", label: "Science" },
  { value: "technology", label: "Technology" },
  { value: "engineering", label: "Engineering" },
  { value: "mathematics", label: "Mathematics" },
  { value: "data-science", label: "Data Science" },
  { value: "health", label: "Health" },
  { value: "psychology", label: "Psychology" },
  { value: "social-sciences", label: "Social Sciences" },
  { value: "nature-environment", label: "Nature & Environment" },
  { value: "education", label: "Education" },
  { value: "study-aids-test-prep", label: "Study Aids & Test Prep" },
  { value: "reference", label: "Reference" },
  { value: "language-arts", label: "Language Arts" },
  { value: "history", label: "History" },
  { value: "philosophy", label: "Philosophy" },
  { value: "religion-spirituality", label: "Religion & Spirituality" },
  { value: "art", label: "Art" },
  { value: "law", label: "Law" },
  { value: "politics", label: "Politics" },
  { value: "biography-memoir", label: "Biography & Memoir" },
  { value: "business", label: "Business" },
  { value: "finance-money-management", label: "Finance & Money Management" },
  { value: "marketing-sales", label: "Marketing & Sales" },
  { value: "career-growth", label: "Career Growth" },
  { value: "professional-development", label: "Professional Development" },
  { value: "design", label: "Design" },
  { value: "fiction", label: "Fiction" },
  { value: "non-fiction", label: "Non-Fiction" },
  { value: "science-fiction", label: "Science Fiction" },
  { value: "fantasy", label: "Fantasy" },
  { value: "romance", label: "Romance" },
  { value: "thriller-suspense", label: "Thriller & Suspense" },
  { value: "horror", label: "Horror" },
  { value: "poetry", label: "Poetry" },
  { value: "graphic-novels", label: "Graphic Novels" },
  { value: "comics", label: "Comics" },
  { value: "young-adult", label: "Young Adult" },
  { value: "children", label: "Children" },
  { value: "true-crime", label: "True Crime" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "self-improvement", label: "Self Improvement" },
  { value: "cooking-food-wine", label: "Cooking, Food & Wine" },
  { value: "travel", label: "Travel" },
  { value: "parenting-family", label: "Parenting & Family" },
  { value: "entertainment", label: "Entertainment" },
  { value: "sports", label: "Sports" },
  { value: "games-activities", label: "Games & Activities" },
  { value: "news-media", label: "News & Media" },
  { value: "other", label: "Other" },
];

const TERMINAL_STATES = ["completed", "failed"];

function stageIcon(stage) {
  switch (stage) {
    case "done":
      return <CheckCircle2 size={16} className="text-green-400 shrink-0" />;
    case "error":
      return <XCircle size={16} className="text-red-400 shrink-0" />;
    case "skipped":
      return <SkipForward size={16} className="text-yellow-400 shrink-0" />;
    default:
      return <Loader2 size={16} className="text-blue-400 shrink-0 animate-spin" />;
  }
}

export default function FetchDocuments() {
  const [category, setCategory] = useState("science");
  const [count, setCount] = useState(20);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [failReason, setFailReason] = useState(null);
  const [log, setLog] = useState([]);
  const [starting, setStarting] = useState(false);

  const pollRef = useRef(null);
  const lastKeyRef = useRef(null);

  const isRunning = jobId && !TERMINAL_STATES.includes(status);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const appendLog = (p) => {
    if (!p || !p.stage) return;
    // De-dupe consecutive identical snapshots (polling sees the latest only).
    const key = `${p.stage}|${p.source || ""}|${p.title || ""}|${p.url || ""}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    setLog((prev) => [...prev, p]);
  };

  const poll = async (id) => {
    try {
      const res = await apiService.getFetchJobStatus(id);
      if (!res?.success) return;

      setStatus(res.status);
      if (res.progress) {
        setProgress(res.progress);
        appendLog(res.progress);
      }
      if (res.result) setResult(res.result);
      if (res.failReason) setFailReason(res.failReason);

      if (TERMINAL_STATES.includes(res.status)) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        if (res.status === "completed") {
          toast.success(
            `Fetch complete: ${res.result?.ingested ?? 0} document(s) ingested`
          );
        } else {
          toast.error("Fetch job failed");
        }
      }
    } catch (error) {
      console.error("Error polling fetch job:", error);
    }
  };

  const handleStart = async (e) => {
    e.preventDefault();
    setStarting(true);

    // Reset prior run state.
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus(null);
    setProgress(null);
    setResult(null);
    setFailReason(null);
    setLog([]);
    lastKeyRef.current = null;

    try {
      const res = await apiService.startFetchJob(category, Number(count));
      if (res?.success && res.jobId) {
        setJobId(res.jobId);
        setStatus("waiting");
        toast.success("Fetch job queued");
        // Begin polling every 3 seconds.
        poll(res.jobId);
        pollRef.current = setInterval(() => poll(res.jobId), 3000);
      } else {
        toast.error(res?.message || "Failed to queue fetch job");
      }
    } catch (error) {
      console.error("Error starting fetch job:", error);
      toast.error(
        error?.response?.data?.message || "Failed to queue fetch job"
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Fetch Documents</h1>
            <p className="text-dark-400">
              Ingest openly-licensed documents from external sources
            </p>
          </div>
        </div>

        {/* Form */}
        <form
          onSubmit={handleStart}
          className="bg-dark-900 border border-dark-800 rounded-xl p-6 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-dark-300 mb-2">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={isRunning}
                className="w-full px-4 py-2 bg-dark-950 border border-dark-800 rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">
                Count (1–100)
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                disabled={isRunning}
                className="w-full px-4 py-2 bg-dark-950 border border-dark-800 rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={starting || isRunning}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting || isRunning ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <DownloadCloud size={18} />
              )}
              {isRunning ? "Fetching…" : "Start Fetch"}
            </button>
          </div>
        </form>

        {/* Status */}
        {jobId && (
          <div className="bg-dark-900 border border-dark-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-sm text-dark-400">Job</span>
                <code className="text-xs text-dark-300 bg-dark-950 px-2 py-1 rounded">
                  {jobId}
                </code>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-medium px-3 py-1 rounded-full border ${
                    status === "completed"
                      ? "text-green-400 border-green-600/30 bg-green-600/10"
                      : status === "failed"
                      ? "text-red-400 border-red-600/30 bg-red-600/10"
                      : "text-blue-400 border-blue-600/30 bg-blue-600/10"
                  }`}
                >
                  {status || "queued"}
                </span>
                {progress?.total ? (
                  <span className="text-sm text-dark-300">
                    {progress.current ?? 0} / {progress.total}
                  </span>
                ) : null}
              </div>
            </div>

            {progress?.total ? (
              <div className="w-full bg-dark-950 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-2 transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      ((progress.current ?? 0) / progress.total) * 100
                    )}%`,
                  }}
                />
              </div>
            ) : null}

            {failReason && (
              <p className="text-sm text-red-400">{failReason}</p>
            )}

            {/* Activity log */}
            <div className="border border-dark-800 rounded-lg max-h-80 overflow-y-auto divide-y divide-dark-800">
              {log.length === 0 ? (
                <p className="text-sm text-dark-500 p-4">No activity yet…</p>
              ) : (
                log.map((entry, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-2 text-sm">
                    {stageIcon(entry.stage)}
                    <div className="min-w-0">
                      <span className="text-dark-300 capitalize">
                        {entry.stage}
                      </span>
                      {entry.source && (
                        <span className="text-dark-500"> · {entry.source}</span>
                      )}
                      {entry.title && (
                        <span className="text-white"> — {entry.title}</span>
                      )}
                      {entry.error && (
                        <span className="text-red-400"> ({entry.error})</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Final ingested documents */}
            {result?.documents?.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-white">
                  Ingested {result.ingested} of {result.requested}
                </h3>
                <div className="border border-dark-800 rounded-lg divide-y divide-dark-800">
                  {result.documents.map((doc) => (
                    <div
                      key={doc.documentId}
                      className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                    >
                      <span className="text-white truncate">{doc.title}</span>
                      <span className="text-dark-500 shrink-0">
                        {doc.source} · {doc.sizeMB}MB · {doc.license}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
