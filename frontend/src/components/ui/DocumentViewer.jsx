import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { apiService } from "../../services/api";
import { NativePreview } from "./NativePreview";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
  Download,
  ChevronUp,
  ChevronDown,
} from "../../icons";

const PDFViewer = dynamic(
  () => import("./PDFViewer").then((m) => m.PDFViewer),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-dark-800">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    ),
  }
);

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function nextZoom(current, direction) {
  const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
  const target = index + direction;
  if (target < 0) return ZOOM_STEPS[0];
  if (target >= ZOOM_STEPS.length) return ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return ZOOM_STEPS[target];
}

/**
 * The viewer shell: sizing, toolbar and fullscreen, shared by every file type.
 *
 * The previous version put the viewer inside a fixed `aspect-[8.5/11]` box,
 * which on a phone is a ~500px-tall letterbox, and hid its only control behind
 * `group-hover` so touch users could never reach it. Here the frame is sized in
 * viewport units on mobile, every control is a real tappable button, and
 * fullscreen uses the Fullscreen API rather than window.open (which mobile
 * browsers block as a popup).
 */
export const DocumentViewer = ({ document: doc, viewUrl, onDownload }) => {
  const fileType = doc?.fileType?.toLowerCase();
  const isPdf = fileType === "pdf";

  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(!isPdf);
  const [previewError, setPreviewError] = useState(false);

  const frameRef = useRef(null);

  const documentKey = doc?.slug || doc?._id;

  useEffect(() => {
    if (isPdf || !documentKey) return;

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(false);

    apiService
      .getDocumentPreview(documentKey)
      .then((response) => {
        if (cancelled) return;
        setPreview(response.data);
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [documentKey, isPdf]);

  // Keep local state in sync when the user leaves fullscreen with Escape or
  // the system back gesture rather than our button.
  useEffect(() => {
    const handler = () =>
      setIsFullscreen(Boolean(window.document.fullscreenElement));
    window.document.addEventListener("fullscreenchange", handler);
    return () =>
      window.document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const node = frameRef.current;
    if (!node) return;

    try {
      if (window.document.fullscreenElement) {
        await window.document.exitFullscreen();
      } else if (node.requestFullscreen) {
        await node.requestFullscreen();
      } else {
        // iOS Safari has no element fullscreen; fall back to a CSS overlay.
        setIsFullscreen((value) => !value);
      }
    } catch {
      setIsFullscreen((value) => !value);
    }
  }, []);

  const goToPage = useCallback(
    (page) => {
      const node = frameRef.current?.querySelector(`[data-page="${page}"]`);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    []
  );

  useEffect(() => {
    if (!isFullscreen) return;

    const onKeyDown = (event) => {
      if (event.key === "+" || event.key === "=") {
        setScale((s) => nextZoom(s, 1));
      } else if (event.key === "-") {
        setScale((s) => nextZoom(s, -1));
      } else if (event.key === "0") {
        setScale(1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  const zoomLabel = `${Math.round(scale * 100)}%`;

  return (
    <div
      ref={frameRef}
      className={
        isFullscreen
          ? "fixed inset-0 z-[9998] bg-dark-900 flex flex-col"
          : "relative flex flex-col bg-dark-900/50 backdrop-blur-sm rounded-xl border border-dark-800/50 overflow-hidden"
      }
      style={
        isFullscreen
          ? undefined
          : {
              // Tall enough to actually read on a phone, capped so the page
              // still scrolls, and a comfortable fixed height on desktop.
              height: "min(78vh, 900px)",
              minHeight: 420,
            }
      }
    >
      {/* Toolbar - always visible, never hover-gated. */}
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-dark-900 border-b border-dark-700 flex-shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale((s) => nextZoom(s, -1))}
            disabled={scale <= ZOOM_STEPS[0]}
            className="p-2 rounded-lg text-dark-300 hover:text-white hover:bg-dark-800 disabled:opacity-30 transition-colors"
            aria-label="Zoom out"
          >
            <ZoomOut size={18} />
          </button>
          <button
            onClick={() => setScale(1)}
            className="px-2 py-1 min-w-[3.5rem] text-xs text-dark-300 hover:text-white tabular-nums transition-colors"
            aria-label="Reset zoom"
          >
            {zoomLabel}
          </button>
          <button
            onClick={() => setScale((s) => nextZoom(s, 1))}
            disabled={scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            className="p-2 rounded-lg text-dark-300 hover:text-white hover:bg-dark-800 disabled:opacity-30 transition-colors"
            aria-label="Zoom in"
          >
            <ZoomIn size={18} />
          </button>
        </div>

        {isPdf && numPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => goToPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="p-2 rounded-lg text-dark-300 hover:text-white hover:bg-dark-800 disabled:opacity-30 transition-colors"
              aria-label="Previous page"
            >
              <ChevronUp size={18} />
            </button>
            <span className="text-xs text-dark-300 select-none tabular-nums whitespace-nowrap">
              {currentPage} / {numPages}
            </span>
            <button
              onClick={() => goToPage(Math.min(numPages, currentPage + 1))}
              disabled={currentPage >= numPages}
              className="p-2 rounded-lg text-dark-300 hover:text-white hover:bg-dark-800 disabled:opacity-30 transition-colors"
              aria-label="Next page"
            >
              <ChevronDown size={18} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={onDownload}
            className="p-2 rounded-lg text-dark-300 hover:text-white hover:bg-dark-800 transition-colors"
            aria-label="Download"
          >
            <Download size={18} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg text-dark-300 hover:text-white hover:bg-dark-800 transition-colors"
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {isPdf ? (
          viewUrl ? (
            <PDFViewer
              url={viewUrl}
              scale={scale}
              onScaleChange={setScale}
              onPageChange={setCurrentPage}
              onNumPages={setNumPages}
            />
          ) : (
            <NativePreview error onDownload={onDownload} />
          )
        ) : (
          <NativePreview
            preview={preview}
            loading={previewLoading}
            error={previewError}
            scale={scale}
            onDownload={onDownload}
          />
        )}
      </div>
    </div>
  );
};
