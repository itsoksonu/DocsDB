import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { useAuth } from "../../contexts/AuthContext";
import { apiService } from "../../services/api";
import { DesktopNavbar } from "../../components/layout/DesktopNavbar";
import {
  Download,
  Eye,
  Bookmark,
  BookmarkCheck,
  Share2,
  Calendar,
  FileText,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Maximize2,
  Flag,
} from "../../icons";
import toast from "react-hot-toast";
import Footer from "../../components/layout/Footer";
import { DocumentCard } from "../../components/common/DocumentCard";
import { CollectionModal } from "../../components/common/CollectionModal";
import { ShareModal } from "../../components/common/ShareModal";
import dynamic from "next/dynamic";
import { DocumentViewerSkeleton } from "../../components/ui/DocumentViewerSkeleton";
import axios from "axios";

const PDFViewer = dynamic(
  () => import("../../components/ui/PDFViewer").then((m) => m.PDFViewer),
  { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center bg-dark-800"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div> }
);

const DocumentViewerPage = ({
  initialDocument,
  initialViewUrl,
  initialRelatedDocs,
  error: serverError,
}) => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();

  const [document, setDocument] = useState(initialDocument);
  const [viewUrl, setViewUrl] = useState(initialViewUrl);
  const [loading, setLoading] = useState(!initialDocument && !serverError);
  const [error, setError] = useState(serverError);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [relatedDocs, setRelatedDocs] = useState(initialRelatedDocs || []);
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  const [csvData, setCsvData] = useState([]);
  const [csvLoading, setCsvLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Sync state with props if they change (e.g. shallow routing)
  useEffect(() => {
    if (initialDocument) setDocument(initialDocument);
    if (initialViewUrl) setViewUrl(initialViewUrl);
    if (initialRelatedDocs) setRelatedDocs(initialRelatedDocs);
    if (serverError) setError(serverError);
    if (initialDocument) setLoading(false);
  }, [initialDocument, initialViewUrl, initialRelatedDocs, serverError]);

  useEffect(() => {
    if (document && user) {
      checkSavedStatus();
    }
    if (document?.fileType === "csv" && viewUrl) {
      fetchCsvContent();
    }
  }, [document, user, viewUrl]);

  // Loading related docs on client if not provided by SSR (fallback)
  useEffect(() => {
    if (id && !initialRelatedDocs) {
      loadRelatedDocuments();
    }
  }, [id, initialRelatedDocs]);

  const loadRelatedDocuments = async () => {
    try {
      if (!id) return;
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

  const fetchCsvContent = async () => {
    try {
      setCsvLoading(true);
      const response = await fetch(viewUrl);
      const text = await response.text();

      // Simple CSV parser (split by newlines, then commas)
      const rows = text
        .split("\n")
        .map((row) => row.split(","))
        .filter((row) => row.some((cell) => cell.trim() !== ""));

      setCsvData(rows);
    } catch (error) {
      console.error("Error fetching CSV:", error);
      toast.error("Failed to load CSV preview");
    } finally {
      setCsvLoading(false);
    }
  };

  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [savedCollectionId, setSavedCollectionId] = useState(null);

  const checkSavedStatus = async () => {
    try {
      const response = await apiService.checkSavedStatus(id);
      setIsSaved(response.data.isSaved);
      setSavedCollectionId(response.data.collectionId || null);
    } catch (error) {
      console.error("Error checking save status:", error);
    }
  };

  const handleSaveClick = () => {
    if (!user) {
      toast.error("Please login to save documents");
      return;
    }
    setShowCollectionModal(true);
  };

  const handleSaveToCollection = async (collectionId) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await apiService.saveDocument(id, collectionId);
      setIsSaved(true);
      setSavedCollectionId(collectionId);
      toast.success(collectionId ? "Saved to collection" : "Document saved");
      checkSavedStatus(); // Refresh status
    } catch (error) {
      console.error("Error saving document:", error);
      toast.error("Failed to save document");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnsave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await apiService.unsaveDocument(id);
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

  const handleDownload = async () => {
    if (viewUrl) {
      window.open(viewUrl, "_blank");

      try {
        await apiService.trackDownload(id);
        toast.success("Download started");
      } catch (error) {
        console.error("Error tracking download:", error);
      }
    }
  };

  const handleShare = () => {
    setIsShareModalOpen(true);
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getViewerUrl = () => {
    if (!viewUrl) return null;

    const type = document.fileType?.toLowerCase();
    const encodedUrl = encodeURIComponent(viewUrl);

    if (["xlsx", "xls", "doc", "docx", "ppt", "pptx"].includes(type)) {
      // Office Live doesn't embed on mobile — fall back to Google Docs viewer
      if (isMobile) {
        return `https://docs.google.com/gview?url=${encodedUrl}&embedded=true`;
      }
      return `https://view.officeapps.live.com/op/embed.aspx?src=${encodedUrl}`;
    }

    return `https://docs.google.com/gview?url=${encodedUrl}&embedded=true`;
  };

  // --- Custom CSV Renderer Component ---
  const renderCsvPreview = () => {
    if (csvLoading) {
      return (
        <div className="w-full h-full flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      );
    }

    if (csvData.length === 0) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-dark-400 p-6">
          <FileText size={48} className="mb-4" />
          <p className="mb-2">No preview data available</p>
        </div>
      );
    }

    return (
      <div className="w-full h-full overflow-auto bg-white text-black p-4">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-300">
              {csvData[0]?.map((header, i) => (
                <th
                  key={i}
                  className="p-2 text-left font-semibold border-r border-gray-200 min-w-[100px]"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {csvData.slice(1).map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-gray-100 hover:bg-blue-50"
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="p-2 border-r border-gray-100 truncate max-w-[200px]"
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderViewer = () => {
    const type = document.fileType?.toLowerCase();

    // 1. Handle CSV natively
    if (type === "csv") {
      return renderCsvPreview();
    }

    // 2. Handle PDFs with react-pdf (works on all devices, no page/size limit)
    if (type === "pdf" && viewUrl) {
      return <PDFViewer url={viewUrl} onFullScreen={handleFullScreen} />;
    }

    // 3. Handle Office files and others via iframe
    const viewerSrc = getViewerUrl();

    if (!viewerSrc) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-dark-400 p-6">
          <FileText size={48} className="mb-4" />
          <p className="mb-2 text-lg font-semibold">Preview not available</p>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            <Download size={16} />
            Download to view
          </button>
        </div>
      );
    }

    return (
      <iframe
        src={viewerSrc}
        className="w-full h-full bg-white"
        title={document.generatedTitle}
        frameBorder="0"
        allowFullScreen
      />
    );
  };

  const handleFullScreen = () => {
    if (viewUrl) {
      window.open(viewUrl, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-950 text-white">
        <DesktopNavbar />
        <DocumentViewerSkeleton />
        <Footer />
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

  // SEO Helpers
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://docsdb.com";
  const canonicalUrl = `${siteUrl}/document/${document._id}`;
  const imageUrl =
    document.thumbnailUrl || `${siteUrl}/assets/og-placeholder.png`; // Fallback image

  // JSON-LD Structured Data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DigitalDocument",
    headline: document.generatedTitle,
    name: document.generatedTitle,
    description: document.generatedDescription,
    datePublished: document.createdAt,
    url: canonicalUrl,
    author: {
      "@type": "Person",
      name: document.userId?.name || "Unknown",
    },
    fileFormat: document.fileType,
    thumbnailUrl: imageUrl,
  };

  return (
    <>
      <Head>
        <title>{document.generatedTitle} - DocsDB</title>
        <meta name="description" content={document.generatedDescription} />
        <link rel="canonical" href={canonicalUrl} />

        {/* Open Graph / Facebook */}
        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:title" content={document.generatedTitle} />
        <meta
          property="og:description"
          content={document.generatedDescription}
        />
        <meta property="og:image" content={imageUrl} />

        {/* Twitter */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content={canonicalUrl} />
        <meta property="twitter:title" content={document.generatedTitle} />
        <meta
          property="twitter:description"
          content={document.generatedDescription}
        />
        <meta property="twitter:image" content={imageUrl} />

        {/* Schema.org JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white">
        <DesktopNavbar />

        <div className="pt-20 md:pt-24 pb-8">
          <div className="max-w-[1600px] mx-auto px-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column - Info & Stats */}
              <div className="lg:col-span-3 space-y-6">
                <button
                  onClick={() => router.back()}
                  className="flex items-center gap-2 text-dark-300 hover:text-white transition-colors text-sm mb-2"
                >
                  <ChevronLeft size={20} />
                  Back
                </button>

                <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl p-4 border border-dark-800/50">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-1 bg-dark-800 rounded text-xs font-medium text-dark-300 uppercase">
                      {document.fileType}
                    </span>
                    {document.category && (
                      <span className="px-2 py-1 bg-blue-500/10 text-blue-400 rounded text-xs font-medium capitalize">
                        {document.category}
                      </span>
                    )}
                  </div>
                  <h1 className="text-xl font-bold mb-3 break-words">
                    {document.generatedTitle}
                  </h1>

                  {document.generatedDescription && (
                    <p
                      className={`text-dark-300 text-sm leading-relaxed mb-4 ${
                        !showMobileDetails
                          ? "line-clamp-2 lg:line-clamp-none"
                          : ""
                      }`}
                    >
                      {document.generatedDescription}
                    </p>
                  )}

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
                        onClick={handleSaveClick}
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
                    <button
                      onClick={() => router.push(`/report/${id}`)}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-transparent hover:bg-dark-800 text-dark-400 hover:text-red-400 border border-dark-800/50 hover:border-dark-700/50 rounded-lg transition-colors text-sm w-full"
                    >
                      <Flag size={16} />
                      Report Issue
                    </button>
                  </div>

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

                <div
                  className={`bg-dark-900/50 backdrop-blur-sm rounded-xl p-4 border border-dark-800/50 ${
                    !showMobileDetails ? "hidden lg:block" : "block"
                  }`}
                >
                  <h2 className="text-sm font-semibold mb-4 text-dark-200 uppercase tracking-wider">
                    Details
                  </h2>
                  <div className="space-y-4">
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

                    {document.tags && document.tags.length > 0 && (
                      <>
                        <div className="h-px bg-dark-800/50" />
                        <div>
                          <p className="text-xs text-dark-400 mb-2">Tags</p>
                          <div className="flex flex-wrap gap-2">
                            {document.tags.map((tag, index) => (
                              <span
                                key={index}
                                className="px-2 py-1 bg-dark-800 text-dark-300 rounded text-xs hover:bg-dark-700 transition-colors cursor-pointer capitalize"
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
                <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl border border-dark-800/50 overflow-hidden sticky top-24 group">
                  {/* Top Action Bar for Viewer */}
                  <div className="absolute top-0 right-0 p-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={handleFullScreen}
                      className="bg-dark-900/80 p-2 rounded-lg text-white hover:bg-blue-600 transition-colors backdrop-blur-sm border border-dark-700 shadow-lg"
                      title="Open in new tab"
                    >
                      <Maximize2 size={20} />
                    </button>
                  </div>

                  <div className="aspect-[8.5/11] w-full bg-dark-800">
                    {renderViewer()}
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
      <CollectionModal
        isOpen={showCollectionModal}
        onClose={() => setShowCollectionModal(false)}
        onSave={handleSaveToCollection}
        onUnsave={isSaved ? handleUnsave : null}
        savedCollectionId={savedCollectionId}
      />
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        document={document}
      />
      <Footer />
    </>
  );
};

export async function getServerSideProps(context) {
  const { id } = context.params;
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

  try {
    // 1. Fetch document view data (includes doc details and viewUrl)
    // Note: We're not passing auth token here, so only public documents will be fetched.
    // If the document is private, the backend should return 403 or 404, which we handle.
    const viewResponse = await axios.get(`${apiUrl}/documents/${id}/view`);

    if (!viewResponse.data?.success) {
      return { notFound: true };
    }

    const { document, viewUrl } = viewResponse.data.data;

    // 2. Fetch related documents
    let relatedDocs = [];
    try {
      const relatedResponse = await axios.get(`${apiUrl}/feed/related/${id}`, {
        params: { limit: 6 },
      });
      relatedDocs = relatedResponse.data?.data || [];
    } catch (err) {
      console.error("Error fetching related docs for SSR:", err.message);
      // Don't fail the whole page if related docs fail
    }

    return {
      props: {
        initialDocument: document,
        initialViewUrl: viewUrl || null,
        initialRelatedDocs: relatedDocs,
      },
    };
  } catch (error) {
    console.error("SSR Error:", error.message);
    if (error.response?.status === 404 || error.response?.status === 403) {
      return { notFound: true };
    }

    // For other errors, we can return an error state or 404
    return {
      props: {
        error: error.message || "Failed to load document",
      },
    };
  }
}

export default DocumentViewerPage;
