// pages/document/[id].jsx
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useAuth } from '../../contexts/AuthContext';
import { apiService } from '../../services/api';
import { DesktopNavbar } from '../../components/layout/DesktopNavbar';
import { 
  Download, 
  Eye, 
  Bookmark, 
  BookmarkCheck,
  Share2, 
  Calendar,
  FileText,
  ChevronLeft,
  AlertCircle
} from '../../icons';
import toast from 'react-hot-toast';
import Footer from "../../components/layout/Footer";

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

      // Get document details
      const docResponse = await apiService.client.get(`/documents/${id}`);
      const docData = docResponse.data.data.document;
      setDocument(docData);

      // Get view URL
      const viewResponse = await apiService.client.get(`/documents/${id}/view`);
      setViewUrl(viewResponse.data.data.viewUrl);
    } catch (err) {
      console.error('Error loading document:', err);
      setError(err.response?.data?.message || 'Failed to load document');
      toast.error('Failed to load document');
    } finally {
      setLoading(false);
    }
  };

  const loadRelatedDocuments = async () => {
    try {
      const response = await apiService.getRelatedDocuments(id, 6);
      setRelatedDocs(response.data.documents || []);
    } catch (err) {
      console.error('Error loading related documents:', err);
    }
  };

  const checkSavedStatus = async () => {
    try {
      const response = await apiService.checkSavedStatus(id);
      setIsSaved(response.data.isSaved);
    } catch (error) {
      console.error('Error checking save status:', error);
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
      console.error('Error toggling save:', error);
      toast.error("Failed to update save status");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = () => {
    if (viewUrl) {
      window.open(viewUrl, '_blank');
      toast.success('Download started');
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
        if (err.name !== 'AbortError') {
          copyToClipboard(shareUrl);
        }
      }
    } else {
      copyToClipboard(shareUrl);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Link copied to clipboard');
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
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
              {error || "The document you're looking for doesn't exist or has been removed."}
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
        
        <div className="pt-20 md:pt-24">
          {/* Back Button */}
          <div className="max-w-7xl mx-auto px-4 py-4">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-dark-300 hover:text-white transition-colors text-sm"
            >
              <ChevronLeft size={20} />
              Back
            </button>
          </div>

          {/* Main Content */}
          <div className="max-w-7xl mx-auto px-4 pb-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - Document Viewer */}
              <div className="lg:col-span-2">
                {/* Document Info Header */}
                <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl p-4 md:p-6 mb-4 border border-dark-800/50">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
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
                      <h1 className="text-2xl md:text-3xl font-bold mb-3">
                        {document.generatedTitle}
                      </h1>
                      {document.generatedDescription && (
                        <p className="text-dark-300 text-sm md:text-base leading-relaxed">
                          {document.generatedDescription}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm"
                    >
                      <Download size={16} />
                      Download
                    </button>
                    <button
                      onClick={handleSaveToggle}
                      disabled={isSaving}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                        isSaved
                          ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                          : 'bg-dark-800 hover:bg-dark-700 text-white'
                      }`}
                    >
                      {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                      {isSaved ? 'Saved' : 'Save'}
                    </button>
                    <button
                      onClick={handleShare}
                      className="flex items-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white rounded-lg transition-colors text-sm"
                    >
                      <Share2 size={16} />
                      Share
                    </button>
                  </div>
                </div>

                {/* Document Viewer */}
                <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl border border-dark-800/50 overflow-hidden">
                  <div className="aspect-[8.5/11] w-full bg-dark-800">
                    {viewUrl && typeof viewUrl === 'string' ? (
                      document.fileType === 'pdf' ? (
                        // For PDFs, use direct embed
                        <iframe
                          src={viewUrl}
                          className="w-full h-full"
                          title={document.generatedTitle}
                          type="application/pdf"
                        />
                      ) : (
                        // For other files, use Google Docs viewer
                        <iframe
                          src={`https://docs.google.com/viewer?url=${encodeURIComponent(viewUrl)}&embedded=true`}
                          className="w-full h-full"
                          title={document.generatedTitle}
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-dark-400 p-6">
                        <FileText size={48} className="mb-4" />
                        <p className="mb-2 text-lg font-semibold">Preview not available</p>
                        <p className="mb-6 text-sm text-center text-dark-500">
                          The document preview couldn't be loaded. Please download to view.
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

              {/* Right Column - Metadata & Related */}
              <div className="lg:col-span-1">
                {/* Document Stats */}
                <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl p-4 md:p-6 mb-4 border border-dark-800/50">
                  <h2 className="text-lg font-semibold mb-4">Document Info</h2>
                  
                  <div className="space-y-4">
                    {/* Uploader */}
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white font-medium flex-shrink-0">
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
                        <p className="text-xs text-dark-400 mb-1">Uploaded by</p>
                        <p className="text-sm font-medium text-white truncate">
                          {document.userId?.name || 'Unknown'}
                        </p>
                      </div>
                    </div>

                    {/* Upload Date */}
                    <div className="flex items-start gap-3">
                      <Calendar size={20} className="text-dark-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs text-dark-400 mb-1">Upload date</p>
                        <p className="text-sm text-white">{formatDate(document.createdAt)}</p>
                      </div>
                    </div>

                    {/* Views */}
                    <div className="flex items-start gap-3">
                      <Eye size={20} className="text-dark-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs text-dark-400 mb-1">Views</p>
                        <p className="text-sm text-white">{document.viewsCount?.toLocaleString() || 0}</p>
                      </div>
                    </div>

                    {/* Downloads */}
                    <div className="flex items-start gap-3">
                      <Download size={20} className="text-dark-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs text-dark-400 mb-1">Downloads</p>
                        <p className="text-sm text-white">{document.downloadsCount?.toLocaleString() || 0}</p>
                      </div>
                    </div>

                    {/* Pages */}
                    {document.pageCount && (
                      <div className="flex items-start gap-3">
                        <FileText size={20} className="text-dark-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-dark-400 mb-1">Pages</p>
                          <p className="text-sm text-white">{document.pageCount}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Tags */}
                  {document.tags && document.tags.length > 0 && (
                    <div className="mt-6">
                      <h3 className="text-sm font-medium mb-3">Tags</h3>
                      <div className="flex flex-wrap gap-2">
                        {document.tags.map((tag, index) => (
                          <span
                            key={index}
                            className="px-3 py-1 bg-dark-800 text-dark-300 rounded-full text-xs hover:bg-dark-700 transition-colors cursor-pointer"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Related Documents */}
                {relatedDocs.length > 0 && (
                  <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl p-4 md:p-6 border border-dark-800/50">
                    <h2 className="text-lg font-semibold mb-4">Related Documents</h2>
                    <div className="space-y-3">
                      {relatedDocs.map((doc) => (
                        <Link
                          key={doc._id}
                          href={`/document/${doc._id}`}
                          className="block p-3 bg-dark-800/50 hover:bg-dark-700/50 rounded-lg transition-colors group"
                        >
                          <div className="flex gap-3">
                            {doc.thumbnailUrl ? (
                              <img
                                src={doc.thumbnailUrl}
                                alt={doc.generatedTitle}
                                className="w-16 h-20 object-cover rounded flex-shrink-0"
                              />
                            ) : (
                              <div className="w-16 h-20 bg-dark-700 rounded flex items-center justify-center flex-shrink-0">
                                <FileText size={20} className="text-dark-400" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors line-clamp-2 mb-1">
                                {doc.generatedTitle}
                              </h3>
                              <p className="text-xs text-dark-400">
                                {doc.viewsCount || 0} views
                              </p>
                            </div>
                          </div>
                        </Link>
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