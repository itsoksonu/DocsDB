// Spreadsheet reading, on ExcelJS.
//
// Replaces the `xlsx` (SheetJS) dependency, which has no fixed version for
// GHSA-4r6h-8v6p-xvw6 (prototype pollution) and GHSA-5pgg-2g8v-p4x9 (ReDoS) and
// was parsing attacker-supplied uploads on five separate code paths.
//
// Those five call sites wanted only three things between them, so they all live
// here rather than each doing its own ExcelJS dance - one place to get the cell
// normalization right, and one place to test it.
//
// On cell normalization: ExcelJS's own `cell.text` is NOT usable as a general
// stringifier, which is easy to miss. For a date it returns a locale- and
// timezone-dependent string ("Mon Jan 15 2024 05:30:00 GMT+0530 (India Standard
// Time)"), and for a formula whose cached result is an error it returns
// "[object Object]". cellToText below handles the value union explicitly.
import ExcelJS from "exceljs";

/**
 * ExcelJS reads Excel serial dates into UTC-based Date objects, so the UTC
 * getters are the ones that round-trip. Local formatting would shift the day
 * either side of midnight depending on the server's timezone.
 *
 * A date at exactly midnight renders as YYYY-MM-DD (matching what SheetJS's
 * sheet_to_csv produced); anything with a time component keeps it.
 */
function formatDate(date) {
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z")
    ? iso.slice(0, 10)
    : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * One cell to a plain string. Mirrors the semantics of the client-side
 * cellToText in frontend/src/components/ui/SheetViewer.jsx so a preview
 * generated here and the interactive viewer agree on what a cell says.
 */
export function cellToText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return "";

  // Formula cells arrive as { formula, result }. The cached result is what Excel
  // shows on screen; it is absent when the file was written without one.
  let raw = value;
  if (typeof value === "object" && value.formula !== undefined) {
    raw = value.result;
  }

  if (raw === null || raw === undefined) return "";

  // #DIV/0! and friends, either directly on the value or nested in a formula's
  // cached result.
  if (typeof raw === "object" && raw.error !== undefined) return String(raw.error);

  if (raw instanceof Date) return formatDate(raw);
  if (typeof raw === "boolean") return raw ? "TRUE" : "FALSE";
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string") return raw;

  if (typeof raw === "object") {
    // Rich text: concatenate the runs.
    if (Array.isArray(raw.richText)) {
      return raw.richText.map((run) => run?.text ?? "").join("");
    }
    // Hyperlink: { text, hyperlink } - the label is what a reader sees.
    if (typeof raw.text === "string") return raw.text;
  }

  return "";
}

/**
 * Loads a workbook from a Buffer or a file path.
 *
 * Note this materializes the whole workbook. Callers on request paths guard the
 * input size first (see documentPreview / documentText); ExcelJS does offer a
 * streaming reader if that ever becomes the bottleneck.
 */
async function loadWorkbook(source) {
  const workbook = new ExcelJS.Workbook();

  if (Buffer.isBuffer(source)) {
    await workbook.xlsx.load(source);
  } else {
    await workbook.xlsx.readFile(source);
  }

  return workbook;
}

/**
 * Sheets as arrays of string rows.
 *
 * Empty rows are dropped and rows are returned in document order, matching the
 * `{ header: 1, blankrows: false, defval: "" }` shape the SheetJS call sites
 * used. `maxRows` replaces SheetJS's `sheetRows` option.
 *
 * @returns {Promise<Array<{name: string, rows: string[][]}>>}
 */
export async function readSheetRows(
  source,
  { maxRows = Infinity, maxSheets = Infinity } = {}
) {
  const workbook = await loadWorkbook(source);

  return workbook.worksheets.slice(0, maxSheets).map((sheet) => {
    const rows = [];
    const width = sheet.columnCount;

    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= maxRows) return;

      const cells = [];
      for (let column = 1; column <= width; column += 1) {
        cells.push(cellToText(row.getCell(column)));
      }

      // includeEmpty:false skips rows with no cell records at all, but a row of
      // empty strings still reads as blank to a person.
      if (cells.some((cell) => cell !== "")) {
        rows.push(cells);
      }
    });

    return { name: sheet.name, rows };
  });
}

function csvEscape(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Sheets as CSV text, for the text-extraction paths (AI context, search index).
 *
 * RFC 4180 quoting, so the output round-trips through the CSV reader used
 * elsewhere in the codebase.
 *
 * One deliberate difference from SheetJS's sheet_to_csv: number formats are not
 * applied, so a cell displayed as "$9.50" extracts as "9.5". For search and AI
 * context the underlying value is the more useful one, and applying formats
 * would mean pulling in a format library server-side.
 *
 * @returns {Promise<Array<{name: string, csv: string}>>}
 */
export async function readSheetsAsCsv(source, { maxRows = Infinity } = {}) {
  const sheets = await readSheetRows(source, { maxRows });

  return sheets.map(({ name, rows }) => ({
    name,
    csv: rows.map((row) => row.map(csvEscape).join(",")).join("\n"),
  }));
}

/**
 * Number of worksheets, used as the "page count" for a spreadsheet.
 * Always at least 1, so a document never reports zero pages.
 */
export async function countWorksheets(source) {
  const workbook = await loadWorkbook(source);
  return Math.max(1, workbook.worksheets.length);
}
