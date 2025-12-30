import { useState, useEffect } from "react";
import {
  X,
  Plus,
  Check,
  Bookmark,
  TrendingUp as CollectionIcon, // Using TrendingUp as a placeholder or import Folder if available from lucide-react directly
  Loader2,
} from "../../icons";
import { apiService } from "../../services/api";
import toast from "react-hot-toast";

// Since Folder isn't exported from icons/index.js, I'll use Bookmark for now,
// or I can import Folder from lucide-react if the project allows direct imports.
// Assuming it's better to stick to project patterns, I'll use Bookmark.

export const CollectionModal = ({
  isOpen,
  onClose,
  onSave,
  onUnsave, // Added
  savedCollectionId = null,
}) => {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState(
    savedCollectionId || "all"
  );

  useEffect(() => {
    if (isOpen) {
      fetchCollections();
      setSelectedCollectionId(savedCollectionId || "all");
    }
  }, [isOpen, savedCollectionId]);

  const fetchCollections = async () => {
    try {
      setLoading(true);
      const response = await apiService.getCollections();
      setCollections(response.data || []);
    } catch (error) {
      console.error("Error fetching collections:", error);
      toast.error("Failed to load collections");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCollection = async (e) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;

    try {
      setCreateLoading(true);
      const response = await apiService.createCollection(
        newCollectionName.trim()
      );
      const newCollection = response.data;

      if (!newCollection || !newCollection._id) {
        throw new Error("Created collection is invalid");
      }

      setCollections((prev) => [...prev, newCollection]);
      setNewCollectionName("");
      // Ensure we set the ID immediately so if user saves right after, it's correct
      setSelectedCollectionId(newCollection._id);
      toast.success("Collection created");
    } catch (error) {
      console.error("Error creating collection:", error);
      toast.error(
        error.response?.data?.message || "Failed to create collection"
      );
    } finally {
      setCreateLoading(false);
    }
  };

  const handleSave = () => {
    // If "all" is selected, we pass null to indicate no specific collection (default)
    const collectionIdToSave =
      selectedCollectionId === "all" ? null : selectedCollectionId;
    onSave(collectionIdToSave);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-dark-900 border border-dark-800 rounded-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-800">
          <h3 className="text-lg font-semibold text-white">
            Save to Collection
          </h3>
          <button
            onClick={onClose}
            className="text-dark-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Collections List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={24} className="animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              {/* Default "All" Option */}
              <button
                onClick={() => setSelectedCollectionId("all")}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
                  selectedCollectionId === "all"
                    ? "bg-blue-500/10 border-blue-500/50 text-blue-400"
                    : "bg-dark-800/50 border-dark-800 hover:border-dark-700 text-dark-300 hover:text-white"
                }`}
              >
                <div
                  className={`p-2 rounded-lg ${
                    selectedCollectionId === "all"
                      ? "bg-blue-500/20"
                      : "bg-dark-800"
                  }`}
                >
                  <Bookmark size={18} />
                </div>
                <div className="flex-1 text-left font-medium">
                  All Saved Items
                </div>
                {selectedCollectionId === "all" && <Check size={18} />}
              </button>

              {/* User Collections */}
              {collections.map((collection) => (
                <button
                  key={collection._id}
                  onClick={() => setSelectedCollectionId(collection._id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    selectedCollectionId === collection._id
                      ? "bg-blue-500/10 border-blue-500/50 text-blue-400"
                      : "bg-dark-800/50 border-dark-800 hover:border-dark-700 text-dark-300 hover:text-white"
                  }`}
                >
                  <div
                    className={`p-2 rounded-lg ${
                      selectedCollectionId === collection._id
                        ? "bg-blue-500/20"
                        : "bg-dark-800"
                    }`}
                  >
                    <Bookmark size={18} />
                  </div>
                  <div className="flex-1 text-left font-medium truncate">
                    {collection.name}
                  </div>
                  {selectedCollectionId === collection._id && (
                    <Check size={18} />
                  )}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer: Create & Save */}
        <div className="p-4 border-t border-dark-800 space-y-4 bg-dark-900">
          {/* Create New Collection Form */}
          <form onSubmit={handleCreateCollection} className="flex gap-2">
            <input
              type="text"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="Create new collection..."
              className="flex-1 bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
            />
            <button
              type="submit"
              disabled={!newCollectionName.trim() || createLoading}
              className="px-3 py-2 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-white rounded-lg border border-dark-700 transition-colors"
            >
              {createLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Plus size={18} />
              )}
            </button>
          </form>

          {/* Main Action Buttons */}
          <div className="flex gap-3">
            {savedCollectionId && onUnsave && (
              <button
                onClick={() => {
                  onUnsave();
                  onClose();
                }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors text-sm font-medium"
              >
                Remove
              </button>
            )}
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm font-medium"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
