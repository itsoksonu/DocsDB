import { useEffect, useRef, useState } from "react";

/**
 * Renders a .docx as Word actually laid it out.
 *
 * The previous path ran the file through mammoth.extractRawText() on the
 * server, which returns one flat string: no fonts, no images, no tables, and -
 * because there are no page boundaries in plain text - nothing that could be
 * paged through. docx-preview reads the OOXML directly and emits one
 * <section class="docx"> per page with the document's own styling.
 *
 * The library is ~200KB and only ever needed on a Word document, so it is
 * imported lazily rather than shipped in the main bundle.
 */
export const DocxPreview = ({ buffer, scale = 1, onNumPages, onRenderError }) => {
  const containerRef = useRef(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!buffer || !container) return undefined;

    let cancelled = false;
    setRendering(true);

    import("docx-preview")
      .then(({ renderAsync }) =>
        renderAsync(buffer, container, null, {
          className: "docx",
          inWrapper: true,
          // The whole point of this component: real page boxes instead of one
          // endless column.
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          // Embed images as data URLs so they survive for the life of the page
          // instead of depending on blob URLs we would have to revoke.
          useBase64URL: true,
        })
      )
      .then(() => {
        if (cancelled) return;

        // Tag the pages so the shared toolbar's page navigation - which finds
        // targets by [data-page] - works here exactly as it does for PDF.
        const pages = container.querySelectorAll("section.docx");
        pages.forEach((page, index) =>
          page.setAttribute("data-page", String(index + 1))
        );

        onNumPages?.(pages.length);
        setRendering(false);
      })
      .catch((error) => {
        if (!cancelled) onRenderError?.(error);
      });

    return () => {
      cancelled = true;
      container.innerHTML = "";
    };
  }, [buffer, onNumPages, onRenderError]);

  return (
    <div className="w-full h-full overflow-auto bg-dark-800 overscroll-contain">
      {rendering && (
        <div className="w-full flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      )}
      {/* `zoom` rather than `transform: scale()` so the scroll height grows
          with the content instead of the pages overflowing a fixed-size box. */}
      <div ref={containerRef} style={{ zoom: scale }} />
    </div>
  );
};
