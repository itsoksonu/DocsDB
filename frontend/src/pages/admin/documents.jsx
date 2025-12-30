import { useState, useEffect } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { apiService } from "../../services/api";
import {
  Search,
  FileText,
  ExternalLink,
  AlertTriangle,
  Trash2,
  Eye,
  ShieldAlert,
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";
import Link from "next/link";

export default function DocumentManagement() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    fetchDocuments();
  }, [page, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchDocuments();
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: 10,
        search,
        status: statusFilter,
      };

      Object.keys(params).forEach((key) => !params[key] && delete params[key]);

      const response = await apiService.getAdminDocuments(params);
      if (response && response.data) {
        setDocuments(response.data.documents);
        setPagination(response.data.pagination);
      }
    } catch (error) {
      console.error("Error fetching documents:", error);
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  const handleTakedown = async (documentId) => {
    const reason = prompt("Enter reason for takedown:");
    if (!reason) return;

    try {
      await apiService.takedownDocument(documentId, { reason });
      toast.success("Document taken down successfully");
      fetchDocuments();
    } catch (error) {
      console.error("Error taking down document:", error);
      toast.error("Failed to take down document");
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Document Management
            </h1>
            <p className="text-dark-400">
              Moderate and manage uploaded documents
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 bg-dark-900 p-4 rounded-xl border border-dark-800">
          <div className="flex-1 relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400"
              size={20}
            />
            <input
              type="text"
              placeholder="Search by title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-dark-950 border border-dark-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-dark-950 border border-dark-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All Status</option>
            <option value="uploaded">Uploaded</option>
            <option value="processed">Processed</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
            <option value="taken_down">Taken Down</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-dark-900 border border-dark-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-dark-950 text-dark-400 uppercase text-xs font-semibold">
                <tr>
                  <th className="px-6 py-4">Document</th>
                  <th className="px-6 py-4">Uploader</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Stats</th>
                  <th className="px-6 py-4">Uploaded</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800">
                {loading ? (
                  <tr>
                    <td
                      colSpan="6"
                      className="px-6 py-8 text-center text-dark-500"
                    >
                      Loading documents...
                    </td>
                  </tr>
                ) : documents.length === 0 ? (
                  <tr>
                    <td
                      colSpan="6"
                      className="px-6 py-8 text-center text-dark-500"
                    >
                      No documents found.
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <tr
                      key={doc._id}
                      className="hover:bg-dark-800/50 transition-colors"
                    >
                      <td className="px-6 py-4 max-w-sm">
                        <div className="flex items-start gap-3">
                          <div className="p-2 bg-dark-800 rounded-lg text-blue-400">
                            <FileText size={20} />
                          </div>
                          <div className="min-w-0">
                            <p
                              className="font-medium text-dark-200 truncate"
                              title={doc.generatedTitle || doc.originalFilename}
                            >
                              {doc.generatedTitle || doc.originalFilename}
                            </p>
                            <p className="text-xs text-dark-500 uppercase">
                              {doc.fileType}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-dark-800 flex items-center justify-center text-xs">
                            {doc.userId?.name?.charAt(0) || "?"}
                          </div>
                          <span className="text-sm text-dark-300 truncate max-w-[150px]">
                            {doc.userId?.name || "Unknown User"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium capitalize ${
                            doc.status === "processed"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : doc.status === "taken_down"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-blue-500/10 text-blue-400"
                          }`}
                        >
                          {doc.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col text-xs text-dark-400">
                          <span>{doc.viewsCount || 0} views</span>
                          <span>{doc.downloadsCount || 0} dl</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-dark-400 text-sm">
                        {format(new Date(doc.createdAt), "MMM d, yyyy")}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/document/${doc._id}`}
                            target="_blank"
                            className="p-2 text-dark-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                            title="View Document"
                          >
                            <ExternalLink size={18} />
                          </Link>
                          {doc.status !== "taken_down" && (
                            <button
                              onClick={() => handleTakedown(doc._id)}
                              className="p-2 text-dark-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                              title="Takedown Document"
                            >
                              <ShieldAlert size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.total > 0 && (
            <div className="px-6 py-4 border-t border-dark-800 flex items-center justify-between">
              <p className="text-sm text-dark-400">
                Showing{" "}
                <span className="font-medium text-dark-200">
                  {(page - 1) * 10 + 1}
                </span>{" "}
                to{" "}
                <span className="font-medium text-dark-200">
                  {Math.min(page * 10, pagination.total)}
                </span>{" "}
                of{" "}
                <span className="font-medium text-dark-200">
                  {pagination.total}
                </span>{" "}
                docs
              </p>
              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1 bg-dark-800 border border-dark-700 rounded text-sm text-dark-300 hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  disabled={!pagination.hasMore}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1 bg-dark-800 border border-dark-700 rounded text-sm text-dark-300 hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
