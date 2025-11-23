import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { useAuth } from "../../contexts/AuthContext";
import { apiService } from "../../services/api";
import { DesktopNavbar } from "../../components/layout/DesktopNavbar";
// Added ChevronDown and ChevronUp to imports
import { Download, Eye, Bookmark, BookmarkCheck, Share2, Calendar, FileText, ChevronLeft, ChevronDown, ChevronUp, AlertCircle } from "../../icons";
import toast from "react-hot-toast";
import Footer from "../../components/layout/Footer";
import { DocumentCard } from "../../components/common/DocumentCard";

const DocumentViewerPage = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();

  const [document, setDocument] = useState(null);
  const [viewUrl, setViewUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [relatedDocs, setRelatedDocs] = useState([]);
  
  // NEW: State for mobile expand/collapse behavior
  const [showMobileDetails, setShowMobileDetails] = useState(false);

  useEffect(() => {
    if (id) {
      loadDocument();
      loadRelatedDocuments();
    }
  }, [id]);

  useEffect(() => {
    if (document && user) {
      checkSavedStatus();
    }
  }, [document, user]);

  const loadDocument = async () => {
    try {
      setLoading(true);
      setError(null);

      const docResponse = await apiService.client.get(`/documents/${id}`);
      const docData = docResponse.data.data.document;
      setDocument(docData);

      const viewResponse = await apiService.client.get(`/documents/${id}/view`);
      setViewUrl(viewResponse.data.data.viewUrl);
    } catch (err) {
      console.error("Error loading document:", err);
      setError(err.response?.data?.message || "Failed to load document");
      toast.error("Failed to load document");
    } finally {
      setLoading(false);
    }
  };

  const loadRelatedDocuments = async () => {
    try {
      const response = await apiService.getRelatedDocuments(id, 6);
      const docs = response.data?.data || response.data || [];

      if (Array.isArray(docs)) {
        setRelatedDocs(docs);
      } else {
        setRelatedDocs([]);
      }
    } catch (err) {
      console.error("Error loading related documents:", err);
    }
  };

  const checkSavedStatus = async () => {
    try {
      const response = await apiService.checkSavedStatus(id);
      setIsSaved(response.data.isSaved);
    } catch (error) {
      console.error("Error checking save status:", error);
    }
  };

  const handleSaveToggle = async () => {
    if (!user) {
      toast.error("Please login to save documents");
      return;
    }

    if (isSaving) return;

    setIsSaving(true);
    try {
      if (isSaved) {
        await apiService.unsaveDocument(id);
        setIsSaved(false);
        toast.success("Document removed from saved");
      } else {
        await apiService.saveDocument(id);
        setIsSaved(true);
        toast.success("Document saved");
      }
    } catch (error) {
      console.error("Error toggling save:", error);
      toast.error("Failed to update save status");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = () => {
    if (viewUrl) {
      window.open(viewUrl, "_blank");
      toast.success("Download started");
    }
  };

  const handleShare = async () => {
    const shareUrl = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title: document.generatedTitle,
          text: document.generatedDescription,
          url: shareUrl,
        });
      } catch (err) {
        if (err.name !== "AbortError") {
          copyToClipboard(shareUrl);
        }
      }
    } else {
      copyToClipboard(shareUrl);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("Link copied to clipboard");
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-950 text-white">
        <DesktopNavbar />
        <div className="pt-24 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="min-h-screen bg-dark-950 text-white">
        <DesktopNavbar />
        <div className="pt-24 px-4">
          <div className="max-w-2xl mx-auto text-center">
            <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Document Not Found</h1>
            <p className="text-dark-300 mb-6">
              {error ||
                "The document you're looking for doesn't exist or has been removed."}
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              <ChevronLeft size={20} />
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{document.generatedTitle} - DocsDB</title>
        <meta name="description" content={document.generatedDescription} />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white">
        <DesktopNavbar />

        <div className="pt-20 md:pt-24 pb-8">
          <div className="max-w-[1600px] mx-auto px-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column - Info & Stats */}
              <div className="lg:col-span-3 space-y-6">
                {/* Back Button */}
                <button
                  onClick={() => router.back()}
                  className="flex items-center gap-2 text-dark-300 hover:text-white transition-colors text-sm mb-2"
                >
                  <ChevronLeft size={20} />
                  Back
                </button>

                {/* Document Info Header */}
                <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl p-4 border border-dark-800/50">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-1 bg-dark-800 rounded text-xs font-medium text-dark-300 uppercase">
                      {document.fileType}
                    </span>
                    {document.category && (
                      <span className="px-2 py-1 bg-blue-500/10 text-blue-400 rounded text-xs font-medium">
                        {document.category}
                      </span>
                    )}
                  </div>
                  <h1 className="text-xl font-bold mb-3 break-words">
                    {document.generatedTitle}
                  </h1>
                  
                  {/* UPDATED: Conditional class for mobile clamping */}
                  {document.generatedDescription && (
                    <p 
                      className={`text-dark-300 text-sm leading-relaxed mb-4 ${
                        !showMobileDetails ? 'line-clamp-2 lg:line-clamp-none' : ''
                      }`}
                    >
                      {document.generatedDescription}
                    </p>
                  )}

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={handleDownload}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm w-full"
                    >
                      <Download size={16} />
                      Download
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={handleSaveToggle}
                        disabled={isSaving}
                        className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                          isSaved
                            ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                            : "bg-dark-800 hover:bg-dark-700 text-white"
                        }`}
                      >
                        {isSaved ? (
                          <BookmarkCheck size={16} />
                        ) : (
                          <Bookmark size={16} />
                        )}
                        {isSaved ? "Saved" : "Save"}
                      </button>
                      <button
                        onClick={handleShare}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white rounded-lg transition-colors text-sm"
                      >
                        <Share2 size={16} />
                        Share
                      </button>
                    </div>
                  </div>

                  {/* NEW: Mobile Toggle Button */}
                  <button
                    onClick={() => setShowMobileDetails(!showMobileDetails)}
                    className="lg:hidden w-full mt-4 pt-2 border-t border-dark-800/50 text-dark-400 hover:text-white text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                  >
                    {showMobileDetails ? (
                      <>
                        Show Less <ChevronUp size={14} />
                      </>
                    ) : (
                      <>
                        Show Details <ChevronDown size={14} />
                      </>
                    )}
                  </button>
                </div>

                {/* Document Stats (Details Card) */}
                <div 
                  className={`bg-dark-900/50 backdrop-blur-sm rounded-xl p-4 border border-dark-800/50 ${
                    !showMobileDetails ? 'hidden lg:block' : 'block'
                  }`}
                >
                  <h2 className="text-sm font-semibold mb-4 text-dark-200 uppercase tracking-wider">
                    Details
                  </h2>

                  <div className="space-y-4">
                    {/* Uploader */}
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                        {document.userId?.avatar ? (
                          <img
                            src={document.userId.avatar}
                            alt={document.userId.name}
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          document.userId?.name?.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-dark-400">Uploaded by</p>
                        <p className="text-sm font-medium text-white truncate">
                          {document.userId?.name || "Unknown"}
                        </p>
                      </div>
                    </div>

                    <div className="h-px bg-dark-800/50" />

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-dark-400 mb-1">
                          Upload date
                        </p>
                        <div className="flex items-center gap-2 text-sm text-white">
                          <Calendar size={14} className="text-dark-400" />
                          {formatDate(document.createdAt)}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-dark-400 mb-1">Views</p>
                        <div className="flex items-center gap-2 text-sm text-white">
                          <Eye size={14} className="text-dark-400" />
                          {document.viewsCount?.toLocaleString() || 0}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-dark-400 mb-1">Downloads</p>
                        <div className="flex items-center gap-2 text-sm text-white">
                          <Download size={14} className="text-dark-400" />
                          {document.downloadsCount?.toLocaleString() || 0}
                        </div>
                      </div>
                      {document.pageCount && (
                        <div>
                          <p className="text-xs text-dark-400 mb-1">Pages</p>
                          <div className="flex items-center gap-2 text-sm text-white">
                            <FileText size={14} className="text-dark-400" />
                            {document.pageCount}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Tags */}
                    {document.tags && document.tags.length > 0 && (
                      <>
                        <div className="h-px bg-dark-800/50" />
                        <div>
                          <p className="text-xs text-dark-400 mb-2">Tags</p>
                          <div className="flex flex-wrap gap-2">
                            {document.tags.map((tag, index) => (
                              <span
                                key={index}
                                className="px-2 py-1 bg-dark-800 text-dark-300 rounded text-xs hover:bg-dark-700 transition-colors cursor-pointer"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Middle Column - Document Viewer */}
              <div className="lg:col-span-6">
                <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl border border-dark-800/50 overflow-hidden sticky top-24">
                  <div className="aspect-[8.5/11] w-full bg-dark-800">
                    {viewUrl && typeof viewUrl === "string" ? (
                      document.fileType === "pdf" ? (
                        <iframe
                          src={viewUrl}
                          className="w-full h-full"
                          title={document.generatedTitle}
                          type="application/pdf"
                        />
                      ) : (
                        <iframe
                          src={`https://docs.google.com/viewer?url=${encodeURIComponent(
                            viewUrl
                          )}&embedded=true`}
                          className="w-full h-full"
                          title={document.generatedTitle}
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-dark-400 p-6">
                        <FileText size={48} className="mb-4" />
                        <p className="mb-2 text-lg font-semibold">
                          Preview not available
                        </p>
                        <p className="mb-6 text-sm text-center text-dark-500">
                          The document preview couldn't be loaded. Please
                          download to view.
                        </p>
                        <button
                          onClick={handleDownload}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
                        >
                          <Download size={16} />
                          Download to view
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column - Related Documents */}
              <div className="lg:col-span-3">
                {relatedDocs.length > 0 && (
                  <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl p-4 border border-dark-800/50 sticky top-24">
                    <h2 className="text-sm font-semibold mb-4 text-dark-200 uppercase tracking-wider">
                      Related Documents
                    </h2>

                    {/* Updated container for Cards */}
                    <div className="flex flex-wrap gap-4 justify-center">
                      {relatedDocs.map((doc) => (
                        <DocumentCard key={doc._id} document={doc} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <Footer />
    </>
  );
};

export default DocumentViewerPage;