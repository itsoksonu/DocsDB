import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../../contexts/AuthContext";
import { apiService } from "../../services/api";
import { DesktopNavbar } from "../../components/layout/DesktopNavbar";
import { DocumentCard } from "../../components/common/DocumentCard";
import { DocumentSkeleton } from "../../components/ui/Skeleton";
import {
  Edit,
  Save,
  X,
  Upload,
  Bookmark,
  // Aliased: jsx-a11y/alt-text matches on the component *name*, so an icon
  // called `Image` gets flagged as needing an alt prop. It is a lucide icon,
  // not an <img> - and the alias also stops it being mistaken for next/image.
  Image as ImageIcon,
  Mail,
  Search,
  Loader2,
} from "../../icons";
import toast from "react-hot-toast";
import Footer from "../../components/layout/Footer";

const ProfilePage = () => {
  const { user, updateUser } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("uploaded");
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [savedDocs, setSavedDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    avatar: "",
  });

  // Search & Pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const observer = useRef();

  // Collections state
  const [collections, setCollections] = useState([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("all");
  const [viewMode, setViewMode] = useState("collections"); // 'collections' or 'documents'
  const [selectedCollectionName, setSelectedCollectionName] =
    useState("All Saved");

  const [uploadLoading, setUploadLoading] = useState(false);
  const [savedLoading, setSavedLoading] = useState(false);
  const [stats, setStats] = useState({ uploadedCount: 0, savedCount: 0 });

  // Collection renaming state. These were declared further down, *after* the
  // `if (!user) return null` early return - so the hook count differed between
  // a logged-out and a logged-in render, which React answers with "Rendered
  // more hooks than during the previous render".
  const [editingCollection, setEditingCollection] = useState(null); // { id, name }
  const [renameValue, setRenameValue] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);

  // The cursor for the next page. A ref rather than state because nothing
  // renders it - it was only ever read back by the following request, and as a
  // dependency of loadDocuments (which also sets it) it made that callback
  // impossible for an effect to depend on without looping.
  const nextCursorRef = useRef(null);

  // These three are declared above the effects that name them in a dependency
  // array: dependency arrays are evaluated during render, so a `const` arrow
  // function defined further down would still be in its temporal dead zone.
  const fetchCollections = useCallback(async () => {
    try {
      const response = await apiService.getCollections();
      setCollections(response.data || []);
    } catch (error) {
      console.error("Error fetching collections:", error);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const response = await apiService.getUserStats();
      setStats(response.data);
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  }, []);

  const loadDocuments = useCallback(
    async (isInitial = false) => {
      if (isInitial) setLoading(true);
      else setIsFetchingMore(true);

      try {
        const cursor = isInitial ? null : nextCursorRef.current;
        const params = {
          limit: 20,
          cursor,
          search: searchQuery,
        };

        let response;
        if (activeTab === "uploaded") {
          response = await apiService.getUserDocuments({
            ...params,
            status: "all",
          });
          setUploadedDocs((prev) =>
            isInitial
              ? response.data.documents
              : [...prev, ...response.data.documents]
          );
        } else {
          // Add collection filter
          if (selectedCollectionId !== "all") {
            params.collectionId = selectedCollectionId;
          }
          response = await apiService.getSavedDocuments(params);
          setSavedDocs((prev) =>
            isInitial
              ? response.data.documents
              : [...prev, ...response.data.documents]
          );
        }

        nextCursorRef.current = response.data.nextCursor;
        setHasMore(!!response.data.nextCursor);
      } catch (error) {
        console.error("Error loading documents:", error);
        toast.error("Failed to load documents");
      } finally {
        if (isInitial) setLoading(false);
        else setIsFetchingMore(false);
      }
    },
    [searchQuery, activeTab, selectedCollectionId]
  );

  useEffect(() => {
    if (user === null) {
      router.replace("/");
    }
  }, [user, router]);

  // Handle URL query parameters for tabs
  useEffect(() => {
    if (router.isReady && router.query.tab) {
      const tab = router.query.tab;
      if (tab === "saved" || tab === "uploaded") {
        setActiveTab(tab);
      }
    }
  }, [router.isReady, router.query.tab]);

  // Fetch collections when on saved tab
  useEffect(() => {
    if (user && activeTab === "saved") {
      fetchCollections();
    }
  }, [user, activeTab, fetchCollections]);

  // Debounce search. loadDocuments' own deps include searchQuery and
  // selectedCollectionId, so depending on the callback covers what this effect
  // used to list by hand.
  useEffect(() => {
    const timer = setTimeout(() => {
      setUploadedDocs([]);
      setSavedDocs([]);
      nextCursorRef.current = null;
      setHasMore(true);
      loadDocuments(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [loadDocuments]);

  // Fetch stats...
  useEffect(() => {
    if (user) {
      loadStats();
    }
  }, [user, uploadedDocs.length, savedDocs.length, loadStats]); // Refresh stats when docs change

  // Reset pagination when the tab or user changes. This deliberately no longer
  // calls loadDocuments: activeTab is one of loadDocuments' own dependencies, so
  // changing tabs already re-creates it and re-runs the loader effect above.
  // Both effects used to call loadDocuments(true), which meant two identical
  // requests on mount and on every tab switch.
  useEffect(() => {
    if (!user) return;

    setUploadedDocs([]);
    setSavedDocs([]);
    nextCursorRef.current = null;
    setHasMore(true);

    // Reset collection selection when switching/loading tabs
    if (activeTab === "uploaded") {
      setSelectedCollectionId("all");
    } else {
      // For saved tab, start with collections view
      setViewMode("collections");
      setSelectedCollectionId("all");
      setSelectedCollectionName("All Saved");
    }
  }, [activeTab, user]);

  const lastElementRef = useCallback(
    (node) => {
      if (loading || isFetchingMore) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          loadDocuments(false);
        }
      });
      if (node) observer.current.observe(node);
    },
    [loading, isFetchingMore, hasMore, loadDocuments]
  );

  const handleEditToggle = () => {
    if (editing) {
      setFormData({
        name: user.name || "",
        avatar: user.avatar || "",
      });
    }
    setEditing(!editing);
  };

  const handleSaveProfile = async () => {
    if (!formData.name.trim()) {
      toast.error("Name is required");
      return;
    }

    try {
      await updateUser({
        name: formData.name.trim(),
        avatar: formData.avatar || user.avatar, // avatar is now S3 key or URL
      });

      setEditing(false);
      toast.success("Profile updated successfully");
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Failed to update profile");
    }
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAvatarUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size should be less than 5MB");
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    const toastId = toast.loading("Uploading avatar...");
    try {
      // 1. Get presigned URL
      const presignResponse = await apiService.getPresignedUrl({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        uploadType: "avatar",
      });

      const { uploadUrl, key } = presignResponse.data;

      // 2. Upload to S3
      await apiService.uploadFileToS3(uploadUrl, file);

      // 3. Update user profile
      const updatedUser = await updateUser({ avatar: key });

      // Update form data to reflect new avatar immediately
      setFormData((prev) => ({
        ...prev,
        avatar: updatedUser.avatar,
      }));

      toast.success("Avatar updated successfully", { id: toastId });
    } catch (error) {
      console.error("Avatar upload failed:", error);
      toast.error("Failed to upload avatar", { id: toastId });
    }
  };

  const handleUploadClick = () => {
    router.push("/upload");
  };

  const currentDocs = activeTab === "uploaded" ? uploadedDocs : savedDocs;
  const showLoading = loading; // Simplified loading state

  if (!user) {
    return null;
  }

  const uploadedCount = stats.uploadedCount;
  const savedCount = stats.savedCount;

  const handleRenameClick = (e, collection) => {
    e.stopPropagation();
    setEditingCollection(collection);
    setRenameValue(collection.name);
  };

  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!renameValue.trim()) return;

    try {
      setRenameLoading(true);
      const response = await apiService.updateCollection(
        editingCollection._id,
        renameValue.trim()
      );

      // Update local state
      setCollections((prev) =>
        prev.map((c) =>
          c._id === editingCollection._id
            ? { ...c, name: renameValue.trim() }
            : c
        )
      );

      // Also update selected collection name if we are currently viewing it
      if (selectedCollectionId === editingCollection._id) {
        setSelectedCollectionName(renameValue.trim());
      }

      toast.success("Collection renamed successfully");
      setEditingCollection(null);
    } catch (error) {
      console.error("Error renaming collection:", error);
      toast.error(
        error.response?.data?.message || "Failed to rename collection"
      );
    } finally {
      setRenameLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-950 text-white">
      <DesktopNavbar onUploadClick={handleUploadClick} />

      {/* Rename Collection Modal */}
      {editingCollection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setEditingCollection(null)}
        >
          <div
            className="bg-dark-900 border border-dark-800 rounded-xl w-full max-w-sm overflow-hidden p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-4">
              Rename Collection
            </h3>
            <form onSubmit={handleRenameSubmit}>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="w-full bg-dark-800 border border-dark-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors mb-4"
                placeholder="Collection name"
                autoFocus
              />
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setEditingCollection(null)}
                  className="px-4 py-2 text-dark-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!renameValue.trim() || renameLoading}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  {renameLoading && (
                    <Loader2 size={16} className="animate-spin" />
                  )}
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="pt-20 md:pt-24 max-w-6xl mx-auto px-2 md:px-4 pb-8">
        {/* Profile Header */}
        <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl md:rounded-2xl p-4 md:p-8 mb-6 md:mb-8 border border-dark-800/50 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 transition-opacity">
            {!editing ? (
              <button
                onClick={handleEditToggle}
                className="p-2 bg-dark-800 hover:bg-dark-700 text-dark-200 hover:text-white rounded-lg transition-colors"
                title="Edit Profile"
              >
                <Edit size={18} />
              </button>
            ) : (
              <button
                onClick={handleEditToggle}
                className="p-2 bg-dark-800 hover:bg-dark-700 text-dark-200 hover:text-white rounded-lg transition-colors"
                title="Cancel"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8">
            {/* Avatar Section */}
            <div className="relative group/avatar">
              <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-white p-0.5">
                <div className="w-full h-full rounded-full bg-dark-900 overflow-hidden relative">
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl md:text-4xl font-bold text-white">
                      {user.name?.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {/* Avatar Upload Overlay - Only visible when editing */}
                  {editing && (
                    <label className="absolute inset-0 bg-black/50 flex items-center justify-center cursor-pointer transition-opacity hover:opacity-100">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        className="hidden"
                      />
                      <ImageIcon size={24} className="text-white" />
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* User Info Section */}
            <div className="flex-1 text-center md:text-left space-y-4">
              {editing ? (
                <div className="space-y-4 max-w-md mx-auto md:mx-0">
                  <div>
                    <label className="block text-xs text-dark-400 mb-1 ml-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        handleInputChange("name", e.target.value)
                      }
                      className="w-full bg-dark-800 border border-dark-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder="Enter your name"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleSaveProfile}
                      className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <Save size={18} />
                      Save Changes
                    </button>
                    <button
                      onClick={handleEditToggle}
                      className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
                      {user.name}
                    </h1>
                    <div className="flex items-center justify-center md:justify-start gap-2 text-dark-400 bg-dark-800/50 w-fit mx-auto md:mx-0 px-3 py-1 rounded-full">
                      <Mail size={14} />
                      <span className="text-sm">{user.email}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-center md:justify-start gap-6 text-sm">
                    <div className="text-center md:text-left">
                      <div className="text-xl font-bold text-white">
                        {stats.uploadedCount}
                      </div>
                      <div className="text-dark-400">Uploads</div>
                    </div>
                    <div className="w-px h-8 bg-dark-800" />
                    <div className="text-center md:text-left">
                      <div className="text-xl font-bold text-white">
                        {stats.savedCount}
                      </div>
                      <div className="text-dark-400">Saved</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tabs Section */}
        <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl md:rounded-2xl p-3 md:p-6 border border-dark-800/50">
          <div className="flex flex-col gap-4 border-b border-dark-800 mb-4 md:mb-6 pb-2">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              {/* Tabs Navigation */}
              <div className="flex items-center justify-center md:justify-start gap-1.5 md:gap-2 flex-1 md:flex-none px-3 md:px-6 py-2.5 md:py-3">
                <button
                  onClick={() => setActiveTab("uploaded")}
                  className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-6 py-2.5 md:py-3 border-b-2 transition-all whitespace-nowrap text-sm md:text-base ${
                    activeTab === "uploaded"
                      ? "border-blue-500 text-blue-500"
                      : "border-transparent text-dark-400 hover:text-white"
                  }`}
                >
                  <Upload size={16} className="md:w-[18px] md:h-[18px]" />
                  <span className="hidden sm:inline">Uploaded Documents</span>
                  <span className="sm:hidden">Uploaded</span>
                  <span className="bg-dark-800 text-dark-300 text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded-full ml-1 md:ml-2">
                    {uploadedCount}
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab("saved")}
                  className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-6 py-2.5 md:py-3 border-b-2 transition-all whitespace-nowrap text-sm md:text-base ${
                    activeTab === "saved"
                      ? "border-blue-500 text-blue-500"
                      : "border-transparent text-dark-400 hover:text-white"
                  }`}
                >
                  <Bookmark size={16} className="md:w-[18px] md:h-[18px]" />
                  <span className="hidden sm:inline">Saved Documents</span>
                  <span className="sm:hidden">Saved</span>
                  <span className="bg-dark-800 text-dark-300 text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded-full ml-1 md:ml-2">
                    {savedCount}
                  </span>
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative w-full md:w-64 mb-2 md:mb-0">
                <input
                  type="text"
                  placeholder={`Search ${activeTab}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                />
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400"
                />
              </div>
            </div>
          </div>

          {/* Tab Content */}
          <div className="min-h-[400px]">
            {activeTab === "saved" && viewMode === "collections" ? (
              // Collections Grid View
              <div className="flex flex-wrap gap-2 md:gap-6 justify-center md:justify-start">
                {/* All Saved "Folder" */}
                <button
                  onClick={() => {
                    setSelectedCollectionId("all");
                    setSelectedCollectionName("All Saved");
                    setViewMode("documents");
                  }}
                  className="group flex flex-col items-center justify-center p-6 bg-dark-800 border border-dark-700 rounded-xl hover:bg-dark-750 hover:border-blue-500/50 transition-all cursor-pointer w-40 h-[15rem]"
                >
                  <div className="p-4 bg-blue-500/10 rounded-full mb-3 group-hover:scale-110 transition-transform">
                    <Bookmark size={32} className="text-blue-500" />
                  </div>
                  <h3 className="font-semibold text-white mb-1">All Saved</h3>
                  <span className="text-xs text-dark-400">
                    {savedCount} items
                  </span>
                </button>

                {collections.map((collection) => (
                  <button
                    key={collection._id}
                    onClick={() => {
                      setSelectedCollectionId(collection._id);
                      setSelectedCollectionName(collection.name);
                      setViewMode("documents");
                    }}
                    className="group flex flex-col items-center justify-center p-0 bg-dark-800 border border-dark-700 rounded-xl hover:bg-dark-750 hover:border-purple-500/50 transition-all cursor-pointer w-40 h-[15rem] relative overflow-hidden"
                  >
                    {collection.thumbnailUrl ? (
                      <>
                        {/* Background Image with Overlay */}
                        <div className="absolute inset-0">
                          <img
                            src={collection.thumbnailUrl}
                            alt={collection.name}
                            className="w-full h-full object-cover opacity-50 group-hover:opacity-40 group-hover:scale-105 transition-all duration-500"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-dark-900/90 via-dark-900/40 to-dark-900/20" />
                        </div>

                        {/* Content */}
                        <div className="relative z-10 flex flex-col items-center justify-center w-full h-full p-6">
                          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                            <div
                              onClick={(e) => handleRenameClick(e, collection)}
                              className="p-2 bg-dark-900/80 hover:bg-dark-800 text-white rounded-lg backdrop-blur-sm transition-colors"
                              title="Rename Collection"
                            >
                              <Edit size={14} />
                            </div>
                          </div>
                          <div className="p-3 bg-purple-500/20 backdrop-blur-sm rounded-full mb-3 shadow-lg">
                            <Bookmark size={24} className="text-purple-400" />
                          </div>
                          <h3 className="font-semibold text-white mb-1 truncate w-full text-center drop-shadow-md">
                            {collection.name}
                          </h3>
                          <span className="text-xs text-dark-200 font-medium px-2 py-0.5 bg-dark-900/50 rounded-full backdrop-blur-sm">
                            {collection.documentCount || 0} items
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center w-full h-full p-6 relative">
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <div
                            onClick={(e) => handleRenameClick(e, collection)}
                            className="p-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors"
                            title="Rename Collection"
                          >
                            <Edit size={14} />
                          </div>
                        </div>
                        <div className="p-4 bg-purple-500/10 rounded-full mb-3 group-hover:scale-110 transition-transform">
                          <Bookmark size={32} className="text-purple-500" />
                        </div>
                        <h3 className="font-semibold text-white mb-1 truncate w-full text-center">
                          {collection.name}
                        </h3>
                        <span className="text-xs text-dark-400">
                          {collection.documentCount || 0} items
                        </span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              // Documents View
              <>
                {/* Back button for Saved Tab */}
                {activeTab === "saved" && (
                  <div className="flex items-center gap-2 mb-6">
                    <button
                      onClick={() => {
                        setViewMode("collections");
                        setSelectedCollectionId("all"); // Reset selection when going back? Or keep it? Keeping it implies we might show it selected in grid. Resetting is safer for now.
                      }}
                      className="flex items-center gap-1 text-sm text-dark-400 hover:text-white transition-colors"
                    >
                      <span className="text-lg">←</span> Back to Collections
                    </button>
                    <div className="h-4 w-px bg-dark-700 mx-2" />
                    <span className="text-sm font-medium text-white">
                      {selectedCollectionName}
                    </span>
                  </div>
                )}

                {showLoading ? (
                  <div className="flex flex-wrap gap-4 md:gap-6 justify-center">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <DocumentSkeleton key={i} />
                    ))}
                  </div>
                ) : currentDocs.length > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-4 md:gap-6 justify-center">
                      {currentDocs.map((document, index) => {
                        if (currentDocs.length === index + 1) {
                          return (
                            <div ref={lastElementRef} key={document._id}>
                              <DocumentCard document={document} />
                            </div>
                          );
                        } else {
                          return (
                            <DocumentCard
                              key={document._id}
                              document={document}
                            />
                          );
                        }
                      })}
                    </div>
                    {isFetchingMore && (
                      <div className="flex flex-wrap gap-4 md:gap-6 justify-center mt-6">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <DocumentSkeleton key={`skeleton-${i}`} />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 md:py-16 px-4">
                    <div className="w-20 h-20 md:w-24 md:h-24 bg-dark-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                      {activeTab === "uploaded" ? (
                        <Upload
                          size={28}
                          className="md:w-8 md:h-8 text-dark-400"
                        />
                      ) : (
                        <Bookmark
                          size={28}
                          className="md:w-8 md:h-8 text-dark-400"
                        />
                      )}
                    </div>
                    <h3 className="text-lg md:text-xl font-semibold text-white mb-2">
                      {searchQuery
                        ? "No documents found"
                        : activeTab === "uploaded"
                        ? "No documents uploaded yet"
                        : "No documents in this collection"}
                    </h3>
                    <p className="text-sm md:text-base text-dark-400 mb-6 max-w-md mx-auto">
                      {searchQuery
                        ? `No ${activeTab} documents match "${searchQuery}"`
                        : activeTab === "uploaded"
                        ? "Start sharing your knowledge by uploading your first document."
                        : "Save documents to this collection to see them here."}
                    </p>
                    {activeTab === "uploaded" && !searchQuery && (
                      <button
                        onClick={handleUploadClick}
                        className="inline-flex items-center gap-2 px-5 md:px-6 py-2.5 md:py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm md:text-base"
                      >
                        <Upload size={16} className="md:w-[18px] md:h-[18px]" />
                        Upload Your First Document
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {/* Footer Section */}
      <Footer />
    </div>
  );
};

export default ProfilePage;
