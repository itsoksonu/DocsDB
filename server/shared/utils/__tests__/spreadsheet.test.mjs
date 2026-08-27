/**
 * Spreadsheet reading, against a real .xlsx built on the fly.
 *
 * These guard the migration off `xlsx` (SheetJS), which had unfixable
 * prototype-pollution and ReDoS advisories while parsing user uploads. The cases
 * below are the ones where ExcelJS's own `cell.text` is wrong and would have
 * shipped silently:
 *
 *   - a date renders as a locale/timezone string
 *     ("Mon Jan 15 2024 05:30:00 GMT+0530 (India Standard Time)")
 *   - a formula whose cached result is an error renders as "[object Object]"
 *
 *   node --test shared/utils/__tests__/spreadsheet.test.mjs
 */

import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";

const {
  cellToText,
  readSheetRows,
  readSheetsAsCsv,
  countWorksheets,
} = await import("../spreadsheet.js");

let file;

before(async () => {
  file = path.join(
    os.tmpdir(),
    `sheet-test-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`
  );

  const workbook = new ExcelJS.Workbook();

  const data = workbook.addWorksheet("Data");
  data.addRow(["Name", "Qty", "When", "Total", "Link", "Rich", "Flag"]);
  data.addRow([
    "Widget",
    3,
    new Date(Date.UTC(2024, 0, 15)),
    { formula: "B2*2", result: 6 },
    { text: "docs", hyperlink: "https://example.com" },
    { richText: [{ text: "bo" }, { text: "ld" }] },
    true,
  ]);
  data.addRow([]); // blank row - must be dropped
  data.addRow([
    "Gadget",
    null,
    new Date(Date.UTC(2024, 5, 1, 13, 45)),
    { formula: "1/0", result: { error: "#DIV/0!" } },
    null,
    "plain",
    false,
  ]);
  // A cell whose displayed value needs CSV quoting.
  data.addRow(['He said "hi", then left', 1, null, null, null, null, null]);

  workbook.addWorksheet("Empty");

  const second = workbook.addWorksheet("Second");
  second.addRow(["only", "one", "row"]);

  await workbook.xlsx.writeFile(file);
});

after(() => {
  if (file) fs.rmSync(file, { force: true });
});

// --- cellToText -----------------------------------------------------------

test("cellToText renders a midnight date as YYYY-MM-DD, not a locale string", () => {
  const text = cellToText({ value: new Date(Date.UTC(2024, 0, 15)) });
  assert.equal(text, "2024-01-15");
  // The specific failure this guards: ExcelJS's cell.text would include a
  // weekday, a time and a timezone name.
  assert.ok(!/GMT|Mon|Jan/.test(text));
});

test("cellToText keeps a time component when there is one", () => {
  assert.equal(
    cellToText({ value: new Date(Date.UTC(2024, 5, 1, 13, 45)) }),
    "2024-06-01 13:45"
  );
});

test("cellToText is timezone-independent", () => {
  // Formatting via local getters would move this across a day boundary in any
  // timezone behind UTC.
  assert.equal(
    cellToText({ value: new Date(Date.UTC(2024, 0, 1, 0, 0)) }),
    "2024-01-01"
  );
});

test("cellToText unwraps a formula to its cached result", () => {
  assert.equal(cellToText({ value: { formula: "B2*2", result: 6 } }), "6");
});

test("cellToText surfaces a formula error rather than [object Object]", () => {
  const text = cellToText({
    value: { formula: "1/0", result: { error: "#DIV/0!" } },
  });
  assert.equal(text, "#DIV/0!");
  assert.notEqual(text, "[object Object]");
});

test("cellToText handles an error value that is not wrapped in a formula", () => {
  assert.equal(cellToText({ value: { error: "#N/A" } }), "#N/A");
});

test("cellToText returns empty for a formula with no cached result", () => {
  assert.equal(cellToText({ value: { formula: "B4*C4" } }), "");
});

test("cellToText concatenates rich text runs", () => {
  assert.equal(
    cellToText({ value: { richText: [{ text: "bo" }, { text: "ld" }] } }),
    "bold"
  );
});

test("cellToText uses the label of a hyperlink, not the URL", () => {
  assert.equal(
    cellToText({ value: { text: "docs", hyperlink: "https://example.com" } }),
    "docs"
  );
});

test("cellToText renders booleans as TRUE/FALSE", () => {
  assert.equal(cellToText({ value: true }), "TRUE");
  assert.equal(cellToText({ value: false }), "FALSE");
});

test("cellToText maps empty-ish values to an empty string", () => {
  for (const value of [null, undefined]) {
    assert.equal(cellToText({ value }), "");
  }
  assert.equal(cellToText({}), "");
  assert.equal(cellToText(undefined), "");
});

test("cellToText preserves zero rather than treating it as empty", () => {
  assert.equal(cellToText({ value: 0 }), "0");
});

// --- readSheetRows --------------------------------------------------------

test("readSheetRows returns every sheet in order", async () => {
  const sheets = await readSheetRows(file);
  assert.deepEqual(
    sheets.map((s) => s.name),
    ["Data", "Empty", "Second"]
  );
});

test("readSheetRows drops blank rows and keeps document order", async () => {
  const [data] = await readSheetRows(file);
  assert.deepEqual(data.rows[0].slice(0, 3), ["Name", "Qty", "When"]);
  // The blank third row is gone, so Gadget follows Widget directly.
  assert.equal(data.rows[1][0], "Widget");
  assert.equal(data.rows[2][0], "Gadget");
  assert.ok(
    data.rows.every((row) => row.some((cell) => cell !== "")),
    "no all-empty row should survive"
  );
});

test("readSheetRows normalises awkward cells end to end", async () => {
  const [data] = await readSheetRows(file);
  const widget = data.rows[1];
  const gadget = data.rows[2];

  assert.equal(widget[2], "2024-01-15"); // date
  assert.equal(widget[3], "6"); // formula result
  assert.equal(widget[4], "docs"); // hyperlink label
  assert.equal(widget[5], "bold"); // rich text
  assert.equal(widget[6], "TRUE"); // boolean

  assert.equal(gadget[1], ""); // null cell
  assert.equal(gadget[3], "#DIV/0!"); // formula error
  assert.equal(gadget[6], "FALSE");
});

test("readSheetRows yields an empty array for an empty sheet", async () => {
  const sheets = await readSheetRows(file);
  const empty = sheets.find((s) => s.name === "Empty");
  assert.deepEqual(empty.rows, []);
});

test("readSheetRows honours maxRows and maxSheets", async () => {
  const capped = await readSheetRows(file, { maxRows: 2, maxSheets: 1 });
  assert.equal(capped.length, 1);
  assert.equal(capped[0].name, "Data");
  assert.equal(capped[0].rows.length, 2);
});

test("readSheetRows accepts a Buffer as well as a path", async () => {
  const fromPath = await readSheetRows(file);
  const fromBuffer = await readSheetRows(fs.readFileSync(file));
  assert.deepEqual(fromBuffer, fromPath);
});

// --- readSheetsAsCsv ------------------------------------------------------

test("readSheetsAsCsv produces one CSV per sheet", async () => {
  const sheets = await readSheetsAsCsv(file);
  assert.deepEqual(
    sheets.map((s) => s.name),
    ["Data", "Empty", "Second"]
  );
  assert.equal(sheets.find((s) => s.name === "Second").csv, "only,one,row");
  assert.equal(sheets.find((s) => s.name === "Empty").csv, "");
});

test("readSheetsAsCsv quotes cells containing quotes and commas (RFC 4180)", async () => {
  const [data] = await readSheetsAsCsv(file);
  // Doubled inner quotes, whole field wrapped.
  assert.ok(
    data.csv.includes('"He said ""hi"", then left"'),
    `expected an escaped field, got: ${data.csv}`
  );
});

test("readSheetsAsCsv round-trips through a naive CSV split", async () => {
  const sheets = await readSheetsAsCsv(file);
  const second = sheets.find((s) => s.name === "Second");
  assert.deepEqual(second.csv.split("\n").map((r) => r.split(",")), [
    ["only", "one", "row"],
  ]);
});

// --- countWorksheets ------------------------------------------------------

test("countWorksheets counts every sheet including empty ones", async () => {
  assert.equal(await countWorksheets(file), 3);
});

test("countWorksheets never reports fewer than one page", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Only");
  const single = path.join(os.tmpdir(), `sheet-one-${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(single);
  try {
    assert.equal(await countWorksheets(single), 1);
  } finally {
    fs.rmSync(single, { force: true });
  }
});

// --- robustness -----------------------------------------------------------

test("a non-spreadsheet input rejects instead of hanging or returning junk", async () => {
  const junk = path.join(os.tmpdir(), `not-a-sheet-${Date.now()}.xlsx`);
  fs.writeFileSync(junk, Buffer.from("this is definitely not a zip"));
  try {
    await assert.rejects(() => readSheetRows(junk));
  } finally {
    fs.rmSync(junk, { force: true });
  }
});
