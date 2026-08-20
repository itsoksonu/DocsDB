import { useState, useCallback, useRef, useEffect, memo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { AlertCircle } from "../../icons";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const getProxiedUrl = (url) => `/api/pdf-proxy?url=${encodeURIComponent(url)}`;

// Pages outside this many screens of the viewport are unmounted. Rendering a
// 400-page PDF all at once locks up low-end phones.
const RENDER_WINDOW = 2;

const PAGE_GAP = 12;

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
  const proxiedUrl = getProxiedUrl(url);

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
      onNumPages?.(pdf.numPages);
    },
    [onNumPages]
  );

  const onDocumentLoadError = useCallback(
    (loadError) => {
      setError(true);
      onError?.(loadError);
    },
    [onError]
  );

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-dark-400 p-6 gap-3">
        <AlertCircle size={28} className="text-red-400" />
        <p className="text-sm text-center">
          This PDF could not be displayed. You can still download it.
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
      <Document
        file={proxiedUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={
          <div className="w-full h-full flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
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
    </div>
  );
};
