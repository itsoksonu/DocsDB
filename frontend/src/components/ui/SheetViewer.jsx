import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Spreadsheet viewer that keeps the workbook's own formatting and does not stop
 * at row 2000.
 *
 * The server path capped everything at MAX_SHEET_ROWS = 2000 and, worse, passed
 * `sheetRows: 2000` to SheetJS so rows past that were never even parsed. It
 * also dropped all styling, because the community build of SheetJS does not
 * read it. ExcelJS does, so parsing moved to the browser: fills, fonts,
 * borders, merges, column widths and number formats survive, and rows stream in
 * as you scroll instead of being truncated.
 *
 * Not carried over: theme-indexed colours (ExcelJS reports them as a theme
 * index without resolving it), conditional formatting, charts and images.
 */

// Rows added per scroll-triggered batch. Large enough that a normal scroll
// never outruns it, small enough that the first paint is quick.
const ROW_BATCH = 500;

// ExcelJS reads the number format but does not apply it: a cell formatted as
// "$"#,##0.00 comes back as the string "1000", and a date comes back as a JS
// Date whose default string form is a full timestamp. ssf is the reference
// implementation of the ECMA-376 format codes, so it does the last step.
// Loaded with the workbook parser so CSV files never pay for it.
let SSF = null;

function safeFormat(numFmt, value) {
  try {
    return SSF ? SSF.format(numFmt, value) : null;
  } catch {
    // A format code we cannot interpret should show the raw value, not break
    // the whole sheet.
    return null;
  }
}

// ssf works in Excel serial days; 25569 is the offset between the 1970 epoch
// and Excel's 1900 epoch.
function toExcelSerial(date) {
  return date.getTime() / 86400000 + 25569;
}

function argbToCss(color) {
  const argb = color?.argb;
  if (!argb || typeof argb !== "string") return null;
  // ExcelJS reports AARRGGBB; CSS wants the RGB, and a fully transparent
  // colour means "no fill" rather than black.
  if (argb.length === 8) {
    if (argb.slice(0, 2) === "00") return null;
    return `#${argb.slice(2)}`;
  }
  return argb.length === 6 ? `#${argb}` : null;
}

function cellToCss(cell) {
  const style = {};
  const { font, fill, border, alignment } = cell.style || {};

  if (font) {
    if (font.bold) style.fontWeight = 600;
    if (font.italic) style.fontStyle = "italic";
    if (font.underline) style.textDecoration = "underline";
    if (font.size) style.fontSize = `${font.size}pt`;
    if (font.name) style.fontFamily = `"${font.name}", sans-serif`;
    const color = argbToCss(font.color);
    if (color) style.color = color;
  }

  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const background = argbToCss(fill.fgColor);
    if (background) style.backgroundColor = background;
  }

  if (alignment) {
    if (alignment.horizontal) style.textAlign = alignment.horizontal;
    if (alignment.vertical) {
      style.verticalAlign =
        alignment.vertical === "middle" ? "middle" : alignment.vertical;
    }
    if (alignment.wrapText) style.whiteSpace = "pre-wrap";
  }

  if (border) {
    for (const side of ["top", "right", "bottom", "left"]) {
      if (!border[side]?.style) continue;
      const color = argbToCss(border[side].color) || "#9ca3af";
      const key = `border${side[0].toUpperCase()}${side.slice(1)}`;
      style[key] = `${
        border[side].style === "thick" ? 2 : 1
      }px solid ${color}`;
    }
  }

  return style;
}

function cellToText(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value.error) return String(value.error);

  // Formula cells arrive as { formula, result }; the result is what Excel puts
  // on screen.
  const raw = value.result !== undefined ? value.result : value;
  const numFmt = cell.style?.numFmt;

  if (raw instanceof Date) {
    const formatted = numFmt ? safeFormat(numFmt, toExcelSerial(raw)) : null;
    return formatted ?? raw.toLocaleDateString();
  }

  if (typeof raw === "number" && numFmt && numFmt !== "General") {
    const formatted = safeFormat(numFmt, raw);
    if (formatted !== null) return formatted;
  }

  // For everything else - strings, rich text, hyperlinks - ExcelJS's own `text`
  // is already correct.
  return cell.text ?? "";
}

function addressToPosition(address) {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) return null;

  let col = 0;
  for (const character of match[1]) {
    col = col * 26 + (character.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]), col };
}

// Merged ranges arrive as "A1:C2" strings. Turn them into a span for the
// top-left cell and a skip-list for the cells it covers.
function buildMergeMaps(merges = []) {
  const spans = new Map();
  const covered = new Set();

  for (const range of merges) {
    const [fromAddress, toAddress] = String(range).split(":");
    const from = addressToPosition(fromAddress);
    const to = addressToPosition(toAddress);
    if (!from || !to) continue;

    spans.set(`${from.row},${from.col}`, {
      rowSpan: to.row - from.row + 1,
      colSpan: to.col - from.col + 1,
    });

    for (let row = from.row; row <= to.row; row += 1) {
      for (let col = from.col; col <= to.col; col += 1) {
        if (row !== from.row || col !== from.col) covered.add(`${row},${col}`);
      }
    }
  }

  return { spans, covered };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character !== '"') {
        field += character;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      // Swallow the LF of a CRLF pair rather than emitting a blank row.
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// Exported so the parsing rules - number formats, merges, column alignment -
// can be tested without rendering a component.
export async function readWorkbook(buffer, fileType) {
  if (fileType === "csv") {
    const text = new TextDecoder("utf-8").decode(buffer);
    const rows = parseCsv(text).map((cells) =>
      cells.map((value, index) => ({ col: index + 1, text: value, style: {} }))
    );

    return [{ name: null, rows, columnWidths: [] }];
  }

  const [{ default: ExcelJS }, ssf] = await Promise.all([
    import("exceljs"),
    import("ssf"),
  ]);
  SSF = ssf.default ?? ssf;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  return workbook.worksheets.map((worksheet) => {
    const { spans, covered } = buildMergeMaps(worksheet.model?.merges);
    const rows = [];

    worksheet.eachRow({ includeEmpty: true }, (excelRow, rowNumber) => {
      const cells = [];

      excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const key = `${rowNumber},${colNumber}`;
        if (covered.has(key)) return;

        cells.push({
          // Carried explicitly because skipping merge-covered cells makes the
          // array index stop matching the column number, which would then line
          // the wrong column widths up against the wrong cells.
          col: colNumber,
          text: cellToText(cell),
          style: cellToCss(cell),
          ...(spans.get(key) || {}),
        });
      });

      rows.push(cells);
    });

    return {
      name: worksheet.name,
      rows,
      // ExcelJS reports width in characters; the usual approximation is seven
      // pixels per character plus padding.
      columnWidths: (worksheet.columns || []).map((column) =>
        column?.width ? Math.round(column.width * 7 + 5) : null
      ),
    };
  });
}

function SheetTable({ sheet, scale }) {
  const [visibleRows, setVisibleRows] = useState(ROW_BATCH);
  const sentinelRef = useRef(null);

  const hasMore = visibleRows < sheet.rows.length;

  // Reveal the next batch when the bottom of the table comes into view, so a
  // long sheet keeps loading instead of stopping at a fixed cap.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleRows((count) => count + ROW_BATCH);
        }
      },
      { rootMargin: "600px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, visibleRows]);

  const rows = useMemo(
    () => sheet.rows.slice(0, visibleRows),
    [sheet.rows, visibleRows]
  );

  return (
    <div>
      {sheet.name && (
        <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-2 px-1">
          {sheet.name}
        </h3>
      )}
      <div className="overflow-x-auto bg-white rounded-lg shadow-lg">
        <table
          className="border-collapse w-full"
          style={{ fontSize: `${scale * 0.875}rem` }}
        >
          <tbody>
            {rows.map((cells, rowIndex) => (
              <tr key={rowIndex}>
                <td className="px-2 py-1.5 text-[10px] text-gray-400 border-r border-b border-gray-200 select-none text-right w-10 sticky left-0 bg-gray-50">
                  {rowIndex + 1}
                </td>
                {cells.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    rowSpan={cell.rowSpan}
                    colSpan={cell.colSpan}
                    className="px-3 py-1.5 border-r border-b border-gray-200 text-gray-900 align-top"
                    style={{
                      width: sheet.columnWidths?.[cell.col - 1] || undefined,
                      ...cell.style,
                    }}
                  >
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center gap-2 py-4 text-xs text-dark-400"
        >
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
          Loading rows {visibleRows.toLocaleString()} of{" "}
          {sheet.rows.length.toLocaleString()}
        </div>
      )}
    </div>
  );
}

export const SheetViewer = ({ buffer, fileType, scale = 1, onRenderError }) => {
  const [sheets, setSheets] = useState(null);

  useEffect(() => {
    if (!buffer) return undefined;

    let cancelled = false;
    setSheets(null);

    readWorkbook(buffer, fileType)
      .then((parsed) => {
        if (!cancelled) setSheets(parsed);
      })
      .catch((error) => {
        if (!cancelled) onRenderError?.(error);
      });

    return () => {
      cancelled = true;
    };
  }, [buffer, fileType, onRenderError]);

  if (!sheets) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-dark-800">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto bg-dark-800 overscroll-contain">
      <div className="p-3 space-y-6">
        {sheets.map((sheet, index) => (
          <SheetTable key={index} sheet={sheet} scale={scale} />
        ))}
      </div>
    </div>
  );
};
