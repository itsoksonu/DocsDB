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
  Edit,
  RefreshCw,
  BarChart3,
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
  const [editingDocument, setEditingDocument] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [reprocessing, setReprocessing] = useState(null);

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

  const handleReprocess = async (documentId) => {
    setReprocessing(documentId);
    try {
      await apiService.reprocessAdminDocument(documentId);
      toast.success("Queued for reprocessing");
      fetchDocuments();
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Failed to queue reprocessing",
      );
    } finally {
      setReprocessing(null);
    }
  };

  const handleEdit = (document) => {
    setEditingDocument(document);
    setShowEditModal(true);
  };

  const handleUpdateDocument = async (documentId, updatedData) => {
    try {
      await apiService.updateAdminDocument(documentId, updatedData);
      toast.success("Document updated successfully");
      setShowEditModal(false);
      setEditingDocument(null);
      fetchDocuments();
    } catch (error) {
      console.error("Error updating document:", error);
      toast.error(error.response?.data?.message || "Failed to update document");
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
            <option value="duplicate">Duplicate</option>
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
                        <Link
                          href={`/admin/documents/${doc._id}`}
                          className="flex items-start gap-3 group"
                        >
                          {doc.thumbnailUrl ? (
                            <img
                              src={doc.thumbnailUrl}
                              alt=""
                              className="w-10 h-12 object-cover rounded border border-dark-800 bg-dark-800 flex-shrink-0"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-10 h-12 bg-dark-800 rounded text-blue-400 flex items-center justify-center flex-shrink-0">
                              <FileText size={18} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p
                              className="font-medium text-dark-200 group-hover:text-blue-400 transition-colors truncate"
                              title={doc.generatedTitle || doc.originalFilename}
                            >
                              {doc.generatedTitle || doc.originalFilename}
                            </p>
                            <p className="text-xs text-dark-500 uppercase">
                              {doc.fileType}
                            </p>
                            {doc.processingError && (
                              <p
                                className="text-xs text-red-400/80 truncate mt-0.5"
                                title={doc.processingError}
                              >
                                {doc.processingError}
                              </p>
                            )}
                          </div>
                        </Link>
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
                            href={`/admin/documents/${doc._id}`}
                            className="p-2 text-dark-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                            title="Details & insights"
                          >
                            <BarChart3 size={18} />
                          </Link>
                          <Link
                            href={`/document/${doc.slug || doc._id}`}
                            target="_blank"
                            className="p-2 text-dark-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                            title="View Document"
                          >
                            <ExternalLink size={18} />
                          </Link>
                          {doc.status === "failed" && (
                            <button
                              onClick={() => handleReprocess(doc._id)}
                              disabled={reprocessing === doc._id}
                              className="p-2 text-dark-400 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors disabled:opacity-40"
                              title="Retry processing"
                            >
                              <RefreshCw
                                size={18}
                                className={
                                  reprocessing === doc._id ? "animate-spin" : ""
                                }
                              />
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(doc)}
                            className="p-2 text-dark-400 hover:text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors"
                            title="Edit Document"
                          >
                            <Edit size={18} />
                          </button>
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

      {/* Edit Document Modal */}
      {showEditModal && editingDocument && (
        <EditDocumentModal
          document={editingDocument}
          onClose={() => {
            setShowEditModal(false);
            setEditingDocument(null);
          }}
          onSave={handleUpdateDocument}
        />
      )}
    </AdminLayout>
  );
}

// EditDocumentModal Component
const EditDocumentModal = ({ document, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    generatedTitle: document.generatedTitle || "",
    generatedDescription: document.generatedDescription || "",
    tags: document.tags?.join(", ") || "",
    category: document.category || "other",
  });
  const [saving, setSaving] = useState(false);

  const categories = [
    { value: "for-you", label: "For You" },
    { value: "technology", label: "Technology" },
    { value: "business", label: "Business" },
    { value: "education", label: "Education" },
    { value: "health", label: "Health" },
    { value: "entertainment", label: "Entertainment" },
    { value: "sports", label: "Sports" },
    { value: "finance-money-management", label: "Finance & Money Management" },
    { value: "games-activities", label: "Games & Activities" },
    { value: "comics", label: "Comics" },
    { value: "philosophy", label: "Philosophy" },
    { value: "career-growth", label: "Career Growth" },
    { value: "politics", label: "Politics" },
    { value: "biography-memoir", label: "Biography & Memoir" },
    { value: "study-aids-test-prep", label: "Study Aids & Test Prep" },
    { value: "law", label: "Law" },
    { value: "art", label: "Art" },
    { value: "science", label: "Science" },
    { value: "history", label: "History" },
    { value: "erotica", label: "Erotica" },
    { value: "lifestyle", label: "Lifestyle" },
    { value: "religion-spirituality", label: "Religion & Spirituality" },
    { value: "self-improvement", label: "Self Improvement" },
    { value: "language-arts", label: "Language Arts" },
    { value: "cooking-food-wine", label: "Cooking, Food & Wine" },
    { value: "true-crime", label: "True Crime" },
    { value: "sheet-music", label: "Sheet Music" },
    { value: "fiction", label: "Fiction" },
    { value: "non-fiction", label: "Non-Fiction" },
    { value: "science-fiction", label: "Science Fiction" },
    { value: "fantasy", label: "Fantasy" },
    { value: "romance", label: "Romance" },
    { value: "thriller-suspense", label: "Thriller & Suspense" },
    { value: "horror", label: "Horror" },
    { value: "poetry", label: "Poetry" },
    { value: "graphic-novels", label: "Graphic Novels" },
    { value: "young-adult", label: "Young Adult" },
    { value: "children", label: "Children" },
    { value: "parenting-family", label: "Parenting & Family" },
    { value: "marketing-sales", label: "Marketing & Sales" },
    { value: "psychology", label: "Psychology" },
    { value: "social-sciences", label: "Social Sciences" },
    { value: "engineering", label: "Engineering" },
    { value: "mathematics", label: "Mathematics" },
    { value: "data-science", label: "Data Science" },
    { value: "nature-environment", label: "Nature & Environment" },
    { value: "travel", label: "Travel" },
    { value: "reference", label: "Reference" },
    { value: "design", label: "Design" },
    { value: "news-media", label: "News & Media" },
    { value: "professional-development", label: "Professional Development" },
    { value: "other", label: "Other" },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const updateData = {
        generatedTitle: formData.generatedTitle.trim(),
        generatedDescription: formData.generatedDescription.trim(),
        tags: formData.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
        category: formData.category,
      };

      await onSave(document._id, updateData);
    } catch (error) {
      console.error("Error in modal submit:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-900 border border-dark-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-dark-900 border-b border-dark-800 px-6 py-4">
          <h2 className="text-xl font-bold text-white">Edit Document</h2>
          <p className="text-sm text-dark-400 mt-1">
            Update metadata for {document.originalFilename}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">
              Title
            </label>
            <input
              type="text"
              value={formData.generatedTitle}
              onChange={(e) =>
                setFormData({ ...formData, generatedTitle: e.target.value })
              }
              maxLength={255}
              className="w-full px-4 py-2 bg-dark-950 border border-dark-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
              placeholder="Enter document title"
            />
            <p className="text-xs text-dark-500 mt-1">
              {formData.generatedTitle.length}/255 characters
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">
              Description
            </label>
            <textarea
              value={formData.generatedDescription}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  generatedDescription: e.target.value,
                })
              }
              maxLength={500}
              rows={4}
              className="w-full px-4 py-2 bg-dark-950 border border-dark-800 rounded-lg text-white focus:outline-none focus:border-blue-500 resize-none"
              placeholder="Enter document description"
            />
            <p className="text-xs text-dark-500 mt-1">
              {formData.generatedDescription.length}/500 characters
            </p>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">
              Tags
            </label>
            <input
              type="text"
              value={formData.tags}
              onChange={(e) =>
                setFormData({ ...formData, tags: e.target.value })
              }
              className="w-full px-4 py-2 bg-dark-950 border border-dark-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
              placeholder="Enter tags separated by commas (e.g., pdf, tutorial, guide)"
            />
            <p className="text-xs text-dark-500 mt-1">
              Separate tags with commas
            </p>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">
              Category
            </label>
            <select
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value })
              }
              className="w-full px-4 py-2 bg-dark-950 border border-dark-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              {categories.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-dark-800">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 bg-dark-800 text-dark-300 rounded-lg hover:bg-dark-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !formData.generatedTitle.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
