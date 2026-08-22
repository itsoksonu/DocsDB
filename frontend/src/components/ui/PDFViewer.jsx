import { useState, useCallback, useRef, useEffect, memo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { AlertCircle } from "../../icons";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// The proxy is a last resort, not the default. On Netlify it runs as a
// function, and those buffer the response rather than streaming it and cap it
// at 6MB - so any normally-sized PDF hung on the spinner and eventually 502'd,
// while working fine under `next dev`. Fetching the signed S3 URL directly also
// lets pdf.js use range requests and start rendering before the whole file
// lands. It needs a CORS policy on the bucket; see docs/s3-cors.md.
const getProxiedUrl = (url) => `/api/pdf-proxy?url=${encodeURIComponent(url)}`;

// Pages outside this many screens of the viewport are unmounted. Rendering a
// 400-page PDF all at once locks up low-end phones.
const RENDER_WINDOW = 2;

const PAGE_GAP = 12;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Continuous-scroll PDF viewer.
 *
 * Replaces a one-page-at-a-time viewer that had no zoom, sat inside a fixed
 * 8.5/11 box and hid its only control behind :hover (so it was unreachable on
 * touch). Scale is owned by the parent toolbar so the same controls drive every
 * file type.
 */
const PdfPage = memo(function PdfPage({
  pageNumber,
  width,
  scale,
  isVisible,
  placeholderHeight,
  onMeasure,
  lightweight,
  registerRef,
}) {
  return (
    <div
      ref={(node) => registerRef(pageNumber, node)}
      data-page={pageNumber}
      className="relative mx-auto bg-white shadow-lg"
      style={{
        width: width * scale,
        // Reserve the right amount of space before a page renders so the
        // scrollbar does not jump as pages stream in.
        minHeight: isVisible ? undefined : placeholderHeight * scale,
        marginBottom: PAGE_GAP,
      }}
    >
      {isVisible ? (
        <Page
          pageNumber={pageNumber}
          width={width * scale}
          renderTextLayer={!lightweight}
          renderAnnotationLayer={!lightweight}
          onLoadSuccess={(page) => onMeasure(pageNumber, page)}
          loading={
            <div
              className="w-full bg-dark-700 animate-pulse"
              style={{ height: placeholderHeight * scale }}
            />
          }
        />
      ) : (
        <div className="w-full h-full bg-dark-700/40" />
      )}
    </div>
  );
});

export const PDFViewer = ({
  url,
  scale = 1,
  onScaleChange,
  onPageChange,
  onNumPages,
  onError,
}) => {
  // null while we work out where to load from, then "direct" or "proxy".
  const [source, setSource] = useState(null);
  const [progress, setProgress] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [error, setError] = useState(false);
  const [baseWidth, setBaseWidth] = useState(0);
  const [visiblePages, setVisiblePages] = useState(new Set([1]));

  const scrollRef = useRef(null);
  const pageRefs = useRef(new Map());
  const pageAspects = useRef(new Map());
  // US Letter until the first page reports its real dimensions.
  const defaultAspect = useRef(792 / 612);
  const pinchState = useRef(null);
  const lastTap = useRef(0);

  // Fit-to-width baseline. Zoom multiplies this rather than replacing it, so
  // "100%" always means "as wide as the container" on every screen size.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Leave room for the scrollbar so a 100% page never triggers
        // horizontal scrolling on desktop.
        setBaseWidth(Math.max(240, Math.floor(entry.contentRect.width) - 16));
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const registerRef = useCallback((pageNumber, node) => {
    if (node) pageRefs.current.set(pageNumber, node);
    else pageRefs.current.delete(pageNumber);
  }, []);

  // Store the aspect ratio, not the height: placeholders then stay correct at
  // any zoom level and for mixed page sizes (a landscape chart page in a
  // portrait report).
  const onMeasure = useCallback((pageNumber, page) => {
    const aspect = page.height / page.width;
    pageAspects.current.set(pageNumber, aspect);
    if (pageNumber === 1) defaultAspect.current = aspect;
  }, []);

  // Which pages to mount, and which page counts as "current".
  const recomputeVisible = useCallback(() => {
    const node = scrollRef.current;
    if (!node || !numPages) return;

    const viewportTop = node.scrollTop;
    const viewportHeight = node.clientHeight;
    const margin = viewportHeight * RENDER_WINDOW;

    const next = new Set();
    let current = 1;
    let bestOverlap = -1;

    for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
      const element = pageRefs.current.get(pageNumber);
      if (!element) {
        // Not mounted yet - keep it in the candidate set near the viewport.
        continue;
      }

      const top = element.offsetTop;
      const bottom = top + element.offsetHeight;

      if (bottom >= viewportTop - margin && top <= viewportTop + viewportHeight + margin) {
        next.add(pageNumber);
      }

      const overlap =
        Math.min(bottom, viewportTop + viewportHeight) - Math.max(top, viewportTop);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        current = pageNumber;
      }
    }

    // Always keep at least the neighbourhood of the current page mounted, even
    // before any element has been measured.
    for (let offset = -1; offset <= 1; offset += 1) {
      const pageNumber = current + offset;
      if (pageNumber >= 1 && pageNumber <= numPages) next.add(pageNumber);
    }

    setVisiblePages((previous) => {
      if (
        previous.size === next.size &&
        [...next].every((page) => previous.has(page))
      ) {
        return previous;
      }
      return next;
    });

    onPageChange?.(current);
  }, [numPages, onPageChange]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    let frame = null;
    const handler = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        recomputeVisible();
      });
    };

    node.addEventListener("scroll", handler, { passive: true });
    handler();

    return () => {
      node.removeEventListener("scroll", handler);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [recomputeVisible]);

  // Pinch to zoom, and double-tap to toggle between fit-width and 2x.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !onScaleChange) return;

    const distance = (touches) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );

    const onTouchStart = (event) => {
      if (event.touches.length === 2) {
        pinchState.current = { start: distance(event.touches), scale };
        return;
      }

      if (event.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap.current < 300) {
          onScaleChange(scale > 1.05 ? 1 : 2);
          lastTap.current = 0;
        } else {
          lastTap.current = now;
        }
      }
    };

    const onTouchMove = (event) => {
      if (event.touches.length !== 2 || !pinchState.current) return;
      // Prevent the browser's own page zoom taking over the gesture.
      event.preventDefault();

      const ratio = distance(event.touches) / pinchState.current.start;
      const next = Math.min(4, Math.max(0.5, pinchState.current.scale * ratio));
      onScaleChange(Number(next.toFixed(2)));
    };

    const onTouchEnd = () => {
      pinchState.current = null;
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
    };
  }, [scale, onScaleChange]);

  const onDocumentLoadSuccess = useCallback(
    (pdf) => {
      setNumPages(pdf.numPages);
      setProgress(null);
      onNumPages?.(pdf.numPages);
    },
    [onNumPages]
  );

  // A bare spinner cannot distinguish "downloading a 60MB scan" from "stuck",
  // which is exactly the ambiguity that made this hard to diagnose.
  const onDocumentLoadProgress = useCallback(({ loaded, total }) => {
    setProgress({ loaded, total });
  }, []);

  const onDocumentLoadError = useCallback(
    (loadError) => {
      // Last line of defence: the probe said direct was reachable but pdf.js
      // still could not parse the response.
      if (source === "direct") {
        setSource("proxy");
        return;
      }

      setError(true);
      onError?.(loadError);
    },
    [source, onError]
  );

  // Work out where to load from *before* handing anything to pdf.js. Letting
  // pdf.js discover the problem itself is not reliable - a cross-origin request
  // the browser blocks can leave its promise pending rather than rejecting,
  // which shows as a spinner that never resolves and no error to fall back on.
  //
  // The probe is a plain GET with no custom headers, deliberately. Adding a
  // Range header would make it a preflighted request, and `Range` is not on the
  // CORS safelist - so a bucket policy that allows ordinary GETs but does not
  // list Range would fail the probe and send every PDF to the proxy, even
  // though loading it directly works fine. A HEAD is no good either: presigned
  // URLs are signed per-method, so HEAD against a GET signature is rejected.
  //
  // fetch resolves as soon as the headers arrive, so the body is aborted rather
  // than downloaded twice.
  useEffect(() => {
    if (!url) return undefined;

    let cancelled = false;
    setSource(null);
    setError(false);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    fetch(url, { method: "GET", signal: controller.signal })
      .then((response) => {
        controller.abort();
        if (!cancelled) setSource(response.ok ? "direct" : "proxy");
      })
      .catch(() => {
        // Missing bucket CORS, an expired signature, or the probe timing out.
        if (!cancelled) setSource("proxy");
      })
      .finally(() => clearTimeout(timer));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [url]);

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-dark-400 p-6 gap-3">
        <AlertCircle size={28} className="text-red-400" />
        <p className="text-sm text-center">
          This PDF could not be displayed. You can still download it.
        </p>
        <p className="text-xs text-dark-500 text-center">
          Tried loading {source === "proxy" ? "through the proxy" : "directly"}.
        </p>
      </div>
    );
  }

  // Text and annotation layers are the expensive part of rendering. Above 2x
  // there are far more glyphs on screen, so drop them and keep scrolling smooth.
  const lightweight = scale > 2;

  return (
    <div
      ref={scrollRef}
      className="w-full h-full overflow-auto bg-dark-800 px-2 py-3 overscroll-contain"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {!source ? (
        <div className="w-full h-full flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : (
      <Document
        // Remount on a source switch so pdf.js starts a clean load rather than
        // reusing the state of the request that failed.
        key={source}
        file={source === "proxy" ? getProxiedUrl(url) : url}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadProgress={onDocumentLoadProgress}
        onLoadError={onDocumentLoadError}
        loading={
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            {progress?.total > 0 && (
              <>
                <div className="w-48 h-1 rounded-full bg-dark-700 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-[width] duration-200"
                    style={{
                      width: `${Math.min(100, (progress.loaded / progress.total) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-dark-400 tabular-nums">
                  {formatBytes(progress.loaded)} of {formatBytes(progress.total)}
                  {source === "proxy" && " · via proxy"}
                </p>
              </>
            )}
          </div>
        }
        error=""
        externalLinkTarget="_blank"
      >
        {baseWidth > 0 &&
          Array.from({ length: numPages || 0 }, (_, index) => index + 1).map(
            (pageNumber) => (
              <PdfPage
                key={pageNumber}
                pageNumber={pageNumber}
                width={baseWidth}
                scale={scale}
                isVisible={visiblePages.has(pageNumber)}
                placeholderHeight={
                  baseWidth *
                  (pageAspects.current.get(pageNumber) || defaultAspect.current)
                }
                onMeasure={onMeasure}
                lightweight={lightweight}
                registerRef={registerRef}
              />
            )
          )}
      </Document>
      )}
    </div>
  );
};
