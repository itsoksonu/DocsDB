import { useMemo } from "react";
import { FileText, AlertCircle, Download } from "../../icons";

/**
 * Renders the structured preview returned by GET /documents/:id/preview.
 *
 * This replaces the Office Live / Google gview iframes. Those embeds were the
 * only reason the viewer behaved differently on phones and desktops, and gview
 * in particular fails silently on mobile. Everything here is plain React, so
 * every device gets the same thing.
 *
 * Fidelity tradeoff: original fonts, images and layout are not reproduced.
 * Download always serves the untouched file.
 */

function TruncationNotice({ children }) {
  return (
    <p className="text-xs text-gray-500 italic py-4 px-1 border-t border-gray-200 mt-4">
      {children}
    </p>
  );
}

function TextPreview({ paragraphs, truncated, scale }) {
  return (
    <div
      className="bg-white text-gray-900 mx-auto max-w-3xl px-5 py-8 sm:px-10 sm:py-12 shadow-lg"
      style={{ fontSize: `${scale}rem`, lineHeight: 1.7 }}
    >
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="mb-4 break-words whitespace-pre-wrap">
          {paragraph}
        </p>
      ))}
      {truncated && (
        <TruncationNotice>
          Preview truncated. Download the file to read the rest.
        </TruncationNotice>
      )}
    </div>
  );
}

function SlidesPreview({ slides, scale }) {
  return (
    <div className="mx-auto max-w-3xl px-3 py-4 space-y-4">
      {slides.map((slide, index) => (
        <div
          key={index}
          className="bg-white text-gray-900 rounded-lg shadow-lg overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200">
            <span className="text-xs font-medium text-gray-500">
              Slide {index + 1}
            </span>
          </div>
          <div
            className="px-5 py-6 sm:px-8 sm:py-8"
            style={{ fontSize: `${scale}rem` }}
          >
            {slide.title && (
              <h3 className="font-semibold mb-4 break-words leading-snug">
                {slide.title}
              </h3>
            )}
            {slide.body?.length > 0 && (
              <ul className="space-y-2">
                {slide.body.map((line, lineIndex) => (
                  <li
                    key={lineIndex}
                    className="flex gap-2 break-words leading-relaxed"
                  >
                    <span className="text-gray-400 flex-shrink-0">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}
            {!slide.title && !slide.body?.length && (
              <p className="text-sm text-gray-400 italic">
                This slide has no text content.
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SheetPreview({ sheets, scale }) {
  return (
    <div className="p-3 space-y-6">
      {sheets.map((sheet, sheetIndex) => (
        <div key={sheetIndex}>
          {sheet.name && (
            <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-2 px-1">
              {sheet.name}
            </h3>
          )}
          {/* The table scrolls horizontally on its own so a 40-column sheet
              never forces the whole page sideways on a phone. */}
          <div className="overflow-x-auto bg-white rounded-lg shadow-lg">
            <table
              className="border-collapse w-full"
              style={{ fontSize: `${scale * 0.875}rem` }}
            >
              <tbody>
                {sheet.rows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className={
                      rowIndex === 0
                        ? "bg-gray-100 sticky top-0"
                        : rowIndex % 2 === 0
                          ? "bg-gray-50"
                          : "bg-white"
                    }
                  >
                    <td className="px-2 py-1.5 text-[10px] text-gray-400 border-r border-gray-200 select-none text-right w-10 sticky left-0 bg-inherit">
                      {rowIndex + 1}
                    </td>
                    {row.map((cell, cellIndex) => {
                      const Cell = rowIndex === 0 ? "th" : "td";
                      return (
                        <Cell
                          key={cellIndex}
                          className={`px-3 py-1.5 border-r border-b border-gray-200 text-gray-900 whitespace-nowrap max-w-xs truncate ${
                            rowIndex === 0 ? "font-semibold text-left" : ""
                          }`}
                          title={cell}
                        >
                          {cell}
                        </Cell>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sheet.truncatedRows && (
            <TruncationNotice>
              Showing the first {sheet.rows.length.toLocaleString()} of{" "}
              {sheet.totalRows.toLocaleString()} rows.
            </TruncationNotice>
          )}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, title, message, onDownload }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-dark-400 p-6 gap-3 text-center">
      <Icon size={40} />
      <p className="text-base font-semibold text-dark-200">{title}</p>
      {message && <p className="text-sm max-w-sm">{message}</p>}
      {onDownload && (
        <button
          onClick={onDownload}
          className="mt-2 flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors"
        >
          <Download size={16} />
          Download to view
        </button>
      )}
    </div>
  );
}

export const NativePreview = ({
  preview,
  loading,
  error,
  scale = 1,
  onDownload,
}) => {
  const isEmpty = useMemo(() => {
    if (!preview) return true;
    if (preview.kind === "text") return !preview.paragraphs?.length;
    if (preview.kind === "slides") return !preview.slides?.length;
    if (preview.kind === "sheet")
      return !preview.sheets?.some((s) => s.rows?.length);
    return true;
  }, [preview]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-dark-800">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full bg-dark-800">
        <EmptyState
          icon={AlertCircle}
          title="Preview unavailable"
          message="We couldn't build a preview for this file, but the original is fine to download."
          onDownload={onDownload}
        />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="w-full h-full bg-dark-800">
        <EmptyState
          icon={FileText}
          title="Nothing to preview"
          message="This file has no extractable text content."
          onDownload={onDownload}
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto bg-dark-800 overscroll-contain">
      {preview.kind === "text" && (
        <TextPreview
          paragraphs={preview.paragraphs}
          truncated={preview.truncated}
          scale={scale}
        />
      )}
      {preview.kind === "slides" && (
        <SlidesPreview slides={preview.slides} scale={scale} />
      )}
      {preview.kind === "sheet" && (
        <SheetPreview sheets={preview.sheets} scale={scale} />
      )}
    </div>
  );
};
