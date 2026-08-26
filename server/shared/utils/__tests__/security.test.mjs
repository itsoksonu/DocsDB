/**
 * Regression tests for the input-handling primitives hardened during the audit.
 *
 * Each case here corresponds to a defect that was live in the codebase, so a
 * failure means the defect is back rather than that a style preference changed.
 *
 *   node --test shared/utils/__tests__/security.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";

const { escapeRegex } = await import("../regex.js");
const { cacheToken } = await import("../cachedCount.js");
const { sanitizeFilename, safeExtension } = await import("../s3.js");

// --- escapeRegex ----------------------------------------------------------
// Was: document/routes.js and admin/routes.js interpolated req.query.search
// straight into a Mongo $regex, so ((a+)+)+$ pinned a mongod thread (ReDoS).

test("escapeRegex neutralises the catastrophic-backtracking pattern", () => {
  const escaped = escapeRegex("((a+)+)+$");

  // Every metacharacter is now literal, so the engine has nothing to backtrack.
  assert.equal(escaped, "\\(\\(a\\+\\)\\+\\)\\+\\$");
  assert.ok(new RegExp(escaped).test("((a+)+)+$"));
  assert.ok(!new RegExp(escaped).test("aaaaaaaa"));
});

test("escapeRegex escapes every regex metacharacter", () => {
  for (const char of ".*+?^${}()|[]\\") {
    const escaped = escapeRegex(char);
    assert.equal(escaped, `\\${char}`, `not escaped: ${char}`);
    // The escaped form must still match the literal character.
    assert.ok(new RegExp(escaped).test(char));
  }
});

test("escapeRegex leaves ordinary search terms usable", () => {
  assert.equal(escapeRegex("annual report 2024"), "annual report 2024");
  assert.ok(
    new RegExp(escapeRegex("annual report"), "i").test("Annual Report 2024.pdf")
  );
});

test("escapeRegex coerces non-strings rather than throwing", () => {
  assert.equal(escapeRegex(undefined), "undefined");
  assert.equal(escapeRegex(null), "null");
  assert.equal(escapeRegex(42), "42");
});

// --- cacheToken -----------------------------------------------------------
// Was: raw user input was interpolated into Redis keys, handing the caller
// control of both key cardinality and key structure (":" was not stripped).

test("cacheToken produces a fixed-length hex token", () => {
  const token = cacheToken("some search term");
  assert.match(token, /^[0-9a-f]{16}$/);
});

test("cacheToken is stable for the same input and distinct across inputs", () => {
  assert.equal(cacheToken("alpha"), cacheToken("alpha"));
  assert.notEqual(cacheToken("alpha"), cacheToken("beta"));
});

test("cacheToken strips key structure out of user input", () => {
  // A raw value like this could previously forge extra key segments.
  const token = cacheToken("a:b:*:injected");
  assert.ok(!token.includes(":"));
  assert.ok(!token.includes("*"));
});

test("cacheToken bounds key length regardless of input size", () => {
  assert.equal(cacheToken("x".repeat(10_000)).length, 16);
});

test("cacheToken maps empty-ish values to a single stable segment", () => {
  for (const empty of [undefined, null, ""]) {
    assert.equal(cacheToken(empty), "none");
  }
});

// --- sanitizeFilename -----------------------------------------------------
// Was: s3.js interpolated the user-supplied originalFilename into
// `attachment; filename="${filename}"`, so an embedded quote broke out of the
// quoted-string and injected extra Content-Disposition parameters.

test("sanitizeFilename cannot break out of the quoted header value", () => {
  const hostile = 'a".pdf"; filename*=UTF-8\'\'evil.html; x="';
  const safe = sanitizeFilename(hostile);

  assert.ok(!safe.includes('"'));
  assert.ok(!safe.includes(";"));
  assert.ok(!safe.includes("'"));
});

test("sanitizeFilename keeps ordinary filenames legible", () => {
  assert.equal(sanitizeFilename("Annual Report 2024.pdf"), "Annual_Report_2024.pdf");
  assert.equal(sanitizeFilename("q1-summary.xlsx"), "q1-summary.xlsx");
});

test("sanitizeFilename bounds length and never returns empty", () => {
  assert.ok(sanitizeFilename("x".repeat(500)).length <= 200);
  assert.equal(sanitizeFilename(""), "download");
  assert.equal(sanitizeFilename(null), "download");
  assert.equal(sanitizeFilename(undefined), "download");

  // A name made entirely of disallowed characters collapses to a safe
  // placeholder rather than to an empty header value.
  assert.ok(sanitizeFilename("///").length > 0);
  assert.match(sanitizeFilename("///"), /^[\w.-]+$/);
});

// --- safeExtension --------------------------------------------------------
// Was: generateFileKey took the extension from originalFilename.split(".").pop()
// verbatim, so "x.tar/../../secret" put "../" into the S3 object key.

test("safeExtension refuses path separators and traversal", () => {
  assert.equal(safeExtension("x.tar/../../secret"), "bin");
  assert.equal(safeExtension("report.pdf/../../../etc/passwd"), "bin");
  assert.equal(safeExtension("no-extension-at-all"), "bin");
});

test("safeExtension accepts the real upload types", () => {
  for (const ext of ["pdf", "docx", "pptx", "xlsx", "csv", "png", "jpg"]) {
    assert.equal(safeExtension(`file.${ext}`), ext);
  }
  // Case is normalised so the key is predictable.
  assert.equal(safeExtension("FILE.PDF"), "pdf");
});

test("safeExtension rejects absurdly long or empty extensions", () => {
  assert.equal(safeExtension(`file.${"a".repeat(20)}`), "bin");
  assert.equal(safeExtension("file."), "bin");
  assert.equal(safeExtension(undefined), "bin");
});
