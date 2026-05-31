import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ChevronLeft, ChevronRight, Maximize2 } from "../../icons";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const getProxiedUrl = (url) =>
  `/api/pdf-proxy?url=${encodeURIComponent(url)}`;

export const PDFViewer = ({ url, onFullScreen }) => {
  const proxiedUrl = getProxiedUrl(url);
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [containerWidth, setContainerWidth] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.floor(entry.contentRect.width));
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages }) => {
    setNumPages(numPages);
    setLoading(false);
  }, []);

  const onDocumentLoadError = useCallback(() => {
    setError(true);
    setLoading(false);
  }, []);

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-dark-400 p-6 gap-4">
        <p className="text-sm text-center">Preview unavailable for this file.</p>
        <button
          onClick={onFullScreen}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors"
        >
          <Maximize2 size={16} />
          Open to view
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-dark-800">
      {/* Page controls */}
      {numPages && numPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-2 bg-dark-900/80 border-b border-dark-700 flex-shrink-0">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="p-1 rounded text-dark-300 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-xs text-dark-300 select-none">
            {currentPage} / {numPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages}
            className="p-1 rounded text-dark-300 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* PDF canvas */}
      <div ref={containerRef} className="flex-1 overflow-auto flex justify-center bg-dark-800 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        )}
        <Document
          file={proxiedUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading=""
        >
          <Page
            pageNumber={currentPage}
            width={containerWidth || undefined}
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        </Document>
      </div>
    </div>
  );
};
