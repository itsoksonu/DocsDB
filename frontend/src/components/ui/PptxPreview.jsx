import { useEffect, useRef, useState } from "react";

/**
 * Renders a .pptx with its own theme rather than as a bullet list.
 *
 * readPptxSlides() on the server pulls text nodes out of the slide XML, so
 * backgrounds, theme colours, fonts, images and text-box positioning were all
 * discarded before the client ever saw the deck. pptx-preview parses the same
 * OOXML but reproduces the layout: it scales each slide to the container width
 * and draws shapes, fills and pictures at their real coordinates.
 *
 * Known gaps: animations and transitions are ignored, and SmartArt and some
 * chart types render approximately. Download still serves the untouched file.
 *
 * The library pulls in echarts for charts, which is large, so it is loaded
 * lazily and only for slide decks.
 */
export const PptxPreview = ({ buffer, scale = 1, onNumPages, onRenderError }) => {
  const scrollRef = useRef(null);
  const hostRef = useRef(null);
  const previewerRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);

  // pptx-preview takes a fixed pixel width and scales slides to it, so it has
  // to be re-created when the container resizes (rotation, fullscreen).
  //
  // Two things stop that becoming a feedback loop. The observer watches the
  // scroll container rather than the host, whose width is a consequence of what
  // we just rendered; and small changes are ignored, because rendering slides
  // makes the content tall enough for a scrollbar to appear, which narrows the
  // container, which would otherwise trigger a re-render that removes the
  // scrollbar again - the flicker. `scrollbar-gutter: stable` below reserves
  // that space up front so the width does not move at all in most browsers.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = Math.max(240, Math.floor(entry.contentRect.width) - 16);
        setWidth((current) => (Math.abs(next - current) > 24 ? next : current));
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!buffer || !host || !width) return undefined;

    let cancelled = false;
    setRendering(true);

    import("pptx-preview")
      .then(({ init }) => {
        if (cancelled) return null;

        host.innerHTML = "";
        // Height is deliberately omitted: in list mode it would turn the
        // library's wrapper into a second nested scroll area fighting ours.
        const previewer = init(host, { width, mode: "list" });
        previewerRef.current = previewer;
        return previewer.preview(buffer);
      })
      .then((pptx) => {
        if (cancelled || !pptx) return;

        // Match the [data-page] contract the toolbar's slide navigation uses.
        host
          .querySelectorAll(".pptx-preview-slide-wrapper")
          .forEach((slide, index) =>
            slide.setAttribute("data-page", String(index + 1))
          );

        onNumPages?.(pptx.slides?.length || 0);
        setRendering(false);
      })
      .catch((error) => {
        if (!cancelled) onRenderError?.(error);
      });

    return () => {
      cancelled = true;
      previewerRef.current?.destroy?.();
      previewerRef.current = null;
      host.innerHTML = "";
    };
  }, [buffer, width, onNumPages, onRenderError]);

  return (
    <div
      ref={scrollRef}
      className="w-full h-full overflow-auto bg-dark-800 overscroll-contain py-3"
      style={{ scrollbarGutter: "stable" }}
    >
      {rendering && (
        <div className="w-full flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      )}
      {/* Hidden until the deck is drawn, so a partially rendered slide is never
          on screen next to the spinner. */}
      <div
        ref={hostRef}
        style={{ zoom: scale, visibility: rendering ? "hidden" : "visible" }}
      />
    </div>
  );
};
