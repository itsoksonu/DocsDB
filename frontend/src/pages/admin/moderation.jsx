import { useState, useEffect, useCallback } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { apiService } from "../../services/api";
import { Search, Flag, CheckCircle, XCircle, AlertOctagon } from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";

export default function ModerationQueue() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [error, setError] = useState(null);

  // useCallback so the effect below can depend on the function itself rather
  // than duplicating its inputs. Its deps are only the two values it reads, and
  // it sets neither of them, so the identity is stable between filter changes.
  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiService.getModerationQueue({
        page,
        limit: 10,
        status: statusFilter,
      });

      if (response && response.data) {
        setItems(response.data.queueItems);
      }
    } catch (err) {
      // A swallowed error here rendered "All caught up! No pending items." on a
      // moderation queue that had simply failed to load - the worst possible
      // failure mode for this screen.
      console.error("Error fetching moderation queue:", err);
      setItems([]);
      setError("Could not load the moderation queue. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const handleProcess = async (reportId, action) => {
    try {
      await apiService.processModerationItem(reportId, { action });
      toast.success(`Report ${action}ed`);
      fetchQueue();
    } catch (error) {
      toast.error("Failed to process report");
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Moderation Queue</h1>
          <p className="text-dark-400">
            Review reported content and user appeals
          </p>
        </div>

        <div className="flex gap-4 border-b border-dark-800 pb-4">
          {["pending", "approved", "rejected", "escalated"].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === status
                  ? "bg-blue-600 text-white"
                  : "text-dark-400 hover:bg-dark-800"
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="text-center text-dark-500 py-12">
              Loading queue...
            </div>
          ) : error ? (
            <div className="text-center py-12 bg-dark-900 rounded-xl border border-red-900/50">
              <AlertOctagon className="mx-auto text-red-500 mb-2" size={32} />
              <p className="text-red-400">{error}</p>
              <button
                onClick={fetchQueue}
                className="mt-4 px-4 py-2 text-sm bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-lg transition-colors"
              >
                Retry
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-dark-500 py-12 bg-dark-900 rounded-xl border border-dark-800">
              <CheckCircle
                className="mx-auto text-emerald-500 mb-2"
                size={32}
              />
              <p>All caught up! No {statusFilter} items.</p>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item._id}
                className="bg-dark-900 border border-dark-800 rounded-xl p-6"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                          item.type === "report"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-blue-500/20 text-blue-400"
                        }`}
                      >
                        {item.type}
                      </span>
                      <span className="text-dark-500 text-xs">
                        {format(new Date(item.createdAt), "MMM d, yyyy HH:mm")}
                      </span>
                    </div>
                    <h3 className="font-bold text-dark-200">
                      Report against:{" "}
                      {item.documentId?.generatedTitle || "Unknown Document"}
                    </h3>
                    <p className="text-dark-400 text-sm mt-1">
                      Reason:{" "}
                      <span className="text-dark-300 italic">
                        &ldquo;{item.reason}&rdquo;
                      </span>
                    </p>
                    <p className="text-xs text-dark-500 mt-2">
                      Reported by: {item.reporterId?.name || "Anonymous"}
                    </p>
                  </div>

                  {statusFilter === "pending" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleProcess(item._id, "approve")}
                        className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20"
                        title="Approve (Take Action)"
                      >
                        <CheckCircle size={20} />
                      </button>
                      <button
                        onClick={() => handleProcess(item._id, "reject")}
                        className="p-2 bg-slate-700 text-dark-400 rounded-lg hover:bg-slate-600"
                        title="Reject (Ignore)"
                      >
                        <XCircle size={20} />
                      </button>
                      <button
                        onClick={() => handleProcess(item._id, "escalate")}
                        className="p-2 bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20"
                        title="Escalate"
                      >
                        <AlertOctagon size={20} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
