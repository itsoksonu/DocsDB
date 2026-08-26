import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import {
  FileText,
  Eye,
  Download,
  User,
  MoreVertical,
  Bookmark,
  Sparkles,
  EyeOff,
  Flag,
  Share2,
  BookmarkCheck,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Copy,
} from "../../icons";
import { Dropdown, DropdownItem } from "../ui/Dropdown";
import { apiService } from "../../services/api";
import toast from "react-hot-toast";
import { useAuth } from "../../contexts/AuthContext";
import { Modal } from "../ui/Modal";
import { ShareModal } from "./ShareModal";
import { CollectionModal } from "./CollectionModal";

export const DocumentCard = ({ document, onUpdate }) => {
  const { user } = useAuth();
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);
  const [statusOverride, setStatusOverride] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [hasCheckedStatus, setHasCheckedStatus] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Collection Modal State
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [savedCollectionId, setSavedCollectionId] = useState(null);

  // Keyed on the document id, not the document object: the parent re-creates
  // that object on every fetch, which would otherwise change this callback's
  // identity on each render.
  const checkSavedStatus = useCallback(async () => {
    try {
      const response = await apiService.checkSavedStatus(document._id);
      setIsSaved(response.data.isSaved);
      setSavedCollectionId(response.data.collectionId || null);
      setHasCheckedStatus(true);
    } catch (error) {
      console.error("Error checking save status:", error);
    }
  }, [document._id]);

  useEffect(() => {
    if (isDropdownOpen && !hasCheckedStatus) {
      checkSavedStatus();
    }
  }, [isDropdownOpen, hasCheckedStatus, checkSavedStatus]);

  // Slug when the document has one, id for anything not yet backfilled.
  const documentHref = document.slug || document._id;
  const status = statusOverride || document.status;

  const handleCardClick = (e) => {
    if (
      e.target.closest(".dropdown-trigger") ||
      e.target.closest(".dropdown-menu")
    ) {
      return;
    }
    // A document that never finished processing has no viewer page to show.
    if (status && status !== "processed") {
      if (status === "duplicate" && document.duplicateOf) {
        // Send them to the copy they already have rather than a dead end.
        router.push(`/document/${document.duplicateOf}`);
        return;
      }

      toast(
        status === "failed"
          ? "This document failed to process. Retry it from the menu."
          : status === "duplicate"
            ? "You already uploaded this file."
            : "This document is still being processed."
      );
      return;
    }
    router.push(`/document/${documentHref}`);
  };

  const handleRetry = async (e) => {
    e.stopPropagation();
    setIsDropdownOpen(false);
    setIsRetrying(true);

    try {
      await apiService.reprocessDocument(document._id);
      toast.success("Queued for reprocessing");
      // The parent owns a cursor-paginated list and may not refetch, so the
      // card reflects the new state itself.
      setStatusOverride("processing");
      onUpdate?.();
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Could not retry this document"
      );
    } finally {
      setIsRetrying(false);
    }
  };

  const handleSaveToggle = async (e) => {
    e.stopPropagation();

    const token = localStorage.getItem("accessToken");
    if (!token) {
      toast.error("Please login to save documents");
      setIsDropdownOpen(false);
      return;
    }

    // Close dropdown to show modal properly
    setIsDropdownOpen(false);

    // Open Collection Modal instead of saving directly
    setShowCollectionModal(true);
  };

  const handleSaveToCollection = async (collectionId) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await apiService.saveDocument(document._id, collectionId);
      setIsSaved(true);
      setSavedCollectionId(collectionId);
      toast.success(collectionId ? "Saved to collection" : "Document saved");
      checkSavedStatus(); // Refresh status
    } catch (error) {
      toast.error("Failed to save document");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnsave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await apiService.unsaveDocument(document._id);
      setIsSaved(false);
      setSavedCollectionId(null);
      toast.success("Document removed from saved");
    } catch (error) {
      console.error("Error removing document:", error);
      toast.error("Failed to remove document");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = async (e) => {
    e.stopPropagation();
    setIsDropdownOpen(false);

    try {
      const response = await apiService.client.get(
        `/documents/${document._id}/view`,
      );
      const viewUrl = response.data.data.viewUrl;
      window.open(viewUrl, "_blank", "noopener,noreferrer");

      // Track download
      await apiService.trackDownload(document._id);

      toast.success("Download started");
    } catch (error) {
      console.error("Error downloading:", error);
      toast.error("Failed to download document");
    }
  };

  const handleShare = (e) => {
    e.stopPropagation();
    setIsDropdownOpen(false);
    setIsShareModalOpen(true);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setIsDeleteModalOpen(false);

    // Optimistic UI: Hide the document immediately
    setIsHidden(true);
    toast.success("Document deleted successfully");

    try {
      await apiService.deleteDocument(document._id);
      // Document stays hidden on success
    } catch (error) {
      console.error("Error deleting document:", error);
      // Revert optimistic update on error
      setIsHidden(false);
      toast.error("Failed to delete document");
      setIsDeleting(false);
    }
  };

  const handleInteraction = async (type) => {
    setIsDropdownOpen(false);

    // Optimistic UI for hiding
    if (type === "hidden") {
      setIsHidden(true);
      toast.success("Document hidden from your feed");
    } else if (type === "more_like_this") {
      toast.success("We'll show you more content like this");
    }

    try {
      await apiService.recordInteraction(document._id, type);
    } catch (error) {
      console.error("Error recording interaction:", error);
      // Revert optimistic update if needed, but for 'hidden' it's less critical if generic error
      if (type === "hidden") setIsHidden(false);
      toast.error("Failed to update preferences");
    }
  };

  const isOwner =
    user &&
    document.userId &&
    (user._id === document.userId._id ||
      user.userId === document.userId._id ||
      user._id === document.userId ||
      user.userId === document.userId);

  if (isHidden) return null;

  return (
    <>
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Document"
        danger
        confirmText="Delete"
        onConfirm={handleDelete}
        isLoading={isDeleting}
      >
        <p>
          Are you sure you want to delete{" "}
          <strong>{document.generatedTitle}</strong>? This action cannot be
          undone.
        </p>
      </Modal>
      <div
        onClick={handleCardClick}
        className="group bg-dark-800 rounded-xl p-3 border border-dark-600 hover:border-dark-400 transition-all duration-300 cursor-pointer w-36 h-[17rem]"
      >
        <div className="flex flex-col gap-2 h-full">
          {/* Thumbnail */}
          <div className="relative w-full h-40 flex-shrink-0 overflow-hidden rounded-lg bg-dark-700">
            {document.thumbnailS3Path ? (
              <img
                src={document.thumbnailUrl}
                alt={document.generatedTitle}
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  imageLoaded ? "opacity-100" : "opacity-0"
                }`}
                onLoad={() => setImageLoaded(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <FileText size={24} className="text-dark-400" />
              </div>
            )}
            {!imageLoaded && document.thumbnailS3Path && (
              <div className="absolute inset-0 bg-dark-700 animate-pulse" />
            )}

            {/* File Type Tag */}
            {document.fileType && (
              <div className="absolute top-2 right-2 px-2 py-1 bg-dark-900/80 backdrop-blur-sm rounded text-xs font-medium text-white uppercase">
                {document.fileType}
              </div>
            )}

            {/* Processing state. Only owners ever see a non-processed card. */}
            {status === "failed" && (
              <div className="absolute inset-0 bg-dark-900/85 flex flex-col items-center justify-center gap-1.5 text-center px-2">
                <AlertTriangle size={18} className="text-red-400" />
                <span className="text-[10px] text-red-300 leading-tight">
                  Processing failed
                </span>
                {isOwner && (
                  <button
                    onClick={handleRetry}
                    disabled={isRetrying}
                    className="mt-1 flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-dark-700 hover:bg-dark-600 text-white rounded transition-colors disabled:opacity-50"
                  >
                    <RefreshCw
                      size={10}
                      className={isRetrying ? "animate-spin" : ""}
                    />
                    {isRetrying ? "Retrying" : "Retry"}
                  </button>
                )}
              </div>
            )}
            {status === "duplicate" && (
              <div className="absolute inset-0 bg-dark-900/85 flex flex-col items-center justify-center gap-1.5 text-center px-2">
                <Copy size={18} className="text-purple-400" />
                <span className="text-[10px] text-purple-300 leading-tight">
                  Duplicate
                </span>
                <span className="text-[9px] text-dark-400 leading-tight">
                  Already in your library
                </span>
              </div>
            )}
            {(status === "processing" || status === "uploaded") && (
              <div className="absolute inset-0 bg-dark-900/85 flex flex-col items-center justify-center gap-1.5 text-center px-2">
                <Loader2 size={18} className="text-blue-400 animate-spin" />
                <span className="text-[10px] text-dark-300 leading-tight">
                  Processing
                </span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex flex-col justify-between flex-1 space-y-2">
            {/* Title */}
            <h3 className="font-semibold text-white text-xs line-clamp-2 group-hover:text-blue-300 transition-colors leading-tight">
              {document.generatedTitle}
            </h3>

            {/* Bottom section */}
            <div className="space-y-2">
              {/* User info */}
              <div className="flex items-center gap-1 text-xs text-dark-400">
                <User size={10} />
                <span className="line-clamp-1">
                  {document.userId?.name || "Unknown"}
                </span>
              </div>

              {/* Views and Downloads */}
              <div className="flex items-center justify-between text-xs text-dark-400">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <Eye size={10} />
                    <span>{document.viewsCount || 0}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Download size={10} />
                    <span>{document.downloadsCount || 0}</span>
                  </div>
                </div>

                {/* More Options */}
                <div className="dropdown-trigger">
                  <Dropdown
                    trigger={
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsDropdownOpen(!isDropdownOpen);
                        }}
                        className="p-1 hover:bg-dark-700 rounded transition-colors"
                      >
                        <MoreVertical
                          size={14}
                          className="text-dark-400 hover:text-white"
                        />
                      </button>
                    }
                    isOpen={isDropdownOpen}
                    onClose={() => setIsDropdownOpen(false)}
                    align="right"
                  >
                    <div className="dropdown-menu">
                      <DropdownItem
                        icon={isSaved ? BookmarkCheck : Bookmark}
                        label={isSaved ? "Saved (Edit)" : "Save for later"}
                        onClick={handleSaveToggle}
                        disabled={isSaving}
                      />
                      <DropdownItem
                        icon={Download}
                        label="Download"
                        onClick={handleDownload}
                      />
                      <DropdownItem
                        icon={Share2}
                        label="Share"
                        onClick={handleShare}
                      />
                      <DropdownItem
                        icon={Sparkles}
                        label="Show more like this"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInteraction("more_like_this");
                        }}
                      />
                      <div className="border-t border-dark-600" />
                      <DropdownItem
                        icon={EyeOff}
                        label="Don't show again"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInteraction("hidden");
                        }}
                      />
                      <DropdownItem
                        icon={Flag}
                        label="Report"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsDropdownOpen(false);
                          router.push(`/report/${document._id}`);
                        }}
                        className="text-red-400 hover:text-red-300"
                      />
                      {isOwner && (
                        <>
                          <div className="border-t border-dark-600" />
                          {status === "failed" && (
                            <DropdownItem
                              icon={RefreshCw}
                              label={
                                isRetrying ? "Retrying..." : "Retry processing"
                              }
                              onClick={handleRetry}
                              disabled={isRetrying}
                            />
                          )}
                          <DropdownItem
                            icon={Trash2}
                            label="Delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsDropdownOpen(false);
                              setIsDeleteModalOpen(true);
                            }}
                            className="text-red-400 hover:text-red-300"
                          />
                        </>
                      )}
                    </div>
                  </Dropdown>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        document={document}
      />
      <CollectionModal
        isOpen={showCollectionModal}
        onClose={() => setShowCollectionModal(false)}
        onSave={handleSaveToCollection}
        onUnsave={isSaved ? handleUnsave : null}
        savedCollectionId={savedCollectionId}
      />
    </>
  );
};
