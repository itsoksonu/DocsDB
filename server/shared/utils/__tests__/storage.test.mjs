/**
 * Reference counting, with StoredFile and S3 stubbed.
 *
 * The failure this guards against is concrete: DELETE used to call
 * S3Manager.deleteObject(document.s3Path) unconditionally. Once two documents
 * can share a key, that destroys a file another user still owns.
 *
 *   node --test shared/utils/__tests__/storage.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const StoredFile = (await import("../../models/StoredFile.js")).default;
const Document = (await import("../../models/Document.js")).default;
const S3Manager = (await import("../s3.js")).default;
const { hashFile, claimStoredFile, releaseStoredFile } = await import(
  "../storage.js"
);

// --- in-memory stand-ins --------------------------------------------------

let rows = [];
let deleted = [];
// Documents that currently point at an s3Path, keyed by path.
let documentsByPath = new Map();

function reset() {
  rows = [];
  deleted = [];
  documentsByPath = new Map();
}

// The authoritative guard asks the documents collection, so it has to be stubbed.
// The file and the thumbnail are looked up on different fields.
Document.countDocuments = async (filter) => {
  const key = filter.s3Path ?? filter.thumbnailS3Path;
  const holders = documentsByPath.get(key) || [];
  const excluded = filter._id?.$ne;
  return holders.filter((id) => String(id) !== String(excluded)).length;
};

StoredFile.findOneAndUpdate = async (filter, update, options = {}) => {
  let row = rows.find((r) => r.hash === filter.hash);

  if (row && filter.refCount?.$gt !== undefined) {
    if (!(row.refCount > filter.refCount.$gt)) return null;
  }

  if (!row) {
    if (!options.upsert) return null;
    row = { ...update.$setOnInsert, refCount: 0, _id: rows.length + 1 };
    rows.push(row);
  }

  if (update.$inc?.refCount) row.refCount += update.$inc.refCount;
  return row;
};

StoredFile.deleteOne = async (filter) => {
  rows = rows.filter((r) => r._id !== filter._id);
  return { deletedCount: 1 };
};

S3Manager.deleteObject = async (key) => {
  deleted.push(key);
};

// --- tests ----------------------------------------------------------------

test("hashFile matches a known SHA-256", async () => {
  const file = path.join(os.tmpdir(), `hash-test-${Date.now()}`);
  fs.writeFileSync(file, "docsdb");

  const expected = crypto.createHash("sha256").update("docsdb").digest("hex");
  assert.equal(await hashFile(file), expected);

  fs.unlinkSync(file);
});

test("first claim keeps its own object", async () => {
  reset();
  const claim = await claimStoredFile({
    hash: "h1",
    s3Path: "uploads/a/1.pdf",
    sizeBytes: 100,
  });

  assert.equal(claim.deduplicated, false);
  assert.equal(claim.s3Path, "uploads/a/1.pdf");
  assert.equal(claim.refCount, 1);
  assert.deepEqual(deleted, [], "nothing should be deleted on a first claim");
});

test("second claim joins the first and drops its redundant upload", async () => {
  reset();
  await claimStoredFile({ hash: "h1", s3Path: "uploads/a/1.pdf", sizeBytes: 100 });
  const claim = await claimStoredFile({
    hash: "h1",
    s3Path: "uploads/b/2.pdf",
    sizeBytes: 100,
  });

  assert.equal(claim.deduplicated, true);
  assert.equal(claim.s3Path, "uploads/a/1.pdf", "should point at the canonical object");
  assert.equal(claim.refCount, 2);
  assert.deepEqual(deleted, ["uploads/b/2.pdf"], "only the redundant copy goes");
});

test("releasing one of two references keeps the shared object", async () => {
  reset();
  await claimStoredFile({ hash: "h1", s3Path: "uploads/a/1.pdf", sizeBytes: 100 });
  await claimStoredFile({ hash: "h1", s3Path: "uploads/b/2.pdf", sizeBytes: 100 });
  // Both documents now point at the canonical key.
  documentsByPath.set("uploads/a/1.pdf", ["doc-a", "doc-b"]);
  deleted = [];

  const result = await releaseStoredFile({
    documentId: "doc-a",
    fileHash: "h1",
    s3Path: "uploads/a/1.pdf",
    thumbnailS3Path: "thumbnails/a/1.pdf.jpg",
  });

  assert.equal(result.deleted, false);
  assert.equal(result.refCount, 1);
  assert.deepEqual(
    deleted,
    // doc-a's own thumbnail is nobody else's, so it goes; the shared source
    // file stays because doc-b still points at it.
    ["thumbnails/a/1.pdf.jpg"],
    "user B still owns a document pointing at the source object"
  );
});

test("releasing the last reference removes the object and its thumbnail", async () => {
  reset();
  await claimStoredFile({ hash: "h1", s3Path: "uploads/a/1.pdf", sizeBytes: 100 });
  await claimStoredFile({ hash: "h1", s3Path: "uploads/b/2.pdf", sizeBytes: 100 });
  documentsByPath.set("uploads/a/1.pdf", ["doc-a", "doc-b"]);
  deleted = [];

  await releaseStoredFile({
    documentId: "doc-a",
    fileHash: "h1",
    s3Path: "uploads/a/1.pdf",
  });
  // doc-a is gone, so it no longer holds the key.
  documentsByPath.set("uploads/a/1.pdf", ["doc-b"]);
  documentsByPath.set("thumbnails/a/1.pdf.jpg", ["doc-b"]);

  const result = await releaseStoredFile({
    documentId: "doc-b",
    fileHash: "h1",
    s3Path: "uploads/a/1.pdf",
    thumbnailS3Path: "thumbnails/a/1.pdf.jpg",
  });

  assert.equal(result.deleted, true);
  assert.equal(result.refCount, 0);
  assert.deepEqual(deleted.sort(), [
    "thumbnails/a/1.pdf.jpg",
    "uploads/a/1.pdf",
  ]);
  assert.equal(rows.length, 0, "the StoredFile row should be gone too");
});

test("a document with no hash and no co-owners deletes its object", async () => {
  reset();
  // Documents that predate deduplication have no fileHash and no StoredFile.
  documentsByPath.set("uploads/legacy/old.pdf", ["doc-legacy"]);
  documentsByPath.set("thumbnails/legacy/old.pdf.jpg", ["doc-legacy"]);

  const result = await releaseStoredFile({
    documentId: "doc-legacy",
    fileHash: undefined,
    s3Path: "uploads/legacy/old.pdf",
    thumbnailS3Path: "thumbnails/legacy/old.pdf.jpg",
  });

  assert.equal(result.deleted, true);
  assert.deepEqual(deleted.sort(), [
    "thumbnails/legacy/old.pdf.jpg",
    "uploads/legacy/old.pdf",
  ]);
});

test("REGRESSION: an unhashed document must not delete a shared object", async () => {
  reset();

  // Exactly what happened in production. Document B was repointed at A's
  // object during a run that then died on E11000, so its fileHash was never
  // persisted. On the next run it looked like an unhashed document that owned
  // its file, and deleted the PDF document A was still using.
  const shared = "uploads/user/original.pdf";
  const sharedThumb = "thumbnails/user/original.pdf.jpg";
  // Both documents were repointed, so both keys are shared.
  documentsByPath.set(shared, ["doc-a", "doc-b"]);
  documentsByPath.set(sharedThumb, ["doc-a", "doc-b"]);

  const result = await releaseStoredFile({
    documentId: "doc-b",
    fileHash: null, // never persisted
    s3Path: shared, // but repointed at A's object
    thumbnailS3Path: sharedThumb,
  });

  assert.equal(result.deleted, false, "must not delete a file another document uses");
  assert.equal(result.referencedBy, 1);
  assert.deepEqual(deleted, [], "no S3 object should have been touched");
});

test("a shared file is kept but the document's own thumbnail is not leaked", async () => {
  reset();
  const shared = "uploads/user/original.pdf";
  documentsByPath.set(shared, ["doc-a", "doc-b"]);
  // Each document kept its own thumbnail, derived from its original key.
  documentsByPath.set("thumbnails/user/b.pdf.jpg", ["doc-b"]);

  const result = await releaseStoredFile({
    documentId: "doc-b",
    fileHash: "h1",
    s3Path: shared,
    thumbnailS3Path: "thumbnails/user/b.pdf.jpg",
  });

  assert.equal(result.deleted, false, "the shared file stays");
  assert.equal(result.thumbnailDeleted, true, "the private thumbnail goes");
  assert.deepEqual(deleted, ["thumbnails/user/b.pdf.jpg"]);
});

test("a shared thumbnail is kept too", async () => {
  reset();
  const shared = "uploads/user/original.pdf";
  const sharedThumb = "thumbnails/user/original.pdf.jpg";
  documentsByPath.set(shared, ["doc-a", "doc-b"]);
  documentsByPath.set(sharedThumb, ["doc-a", "doc-b"]);

  const result = await releaseStoredFile({
    documentId: "doc-b",
    fileHash: "h1",
    s3Path: shared,
    thumbnailS3Path: sharedThumb,
  });

  assert.equal(result.deleted, false);
  assert.equal(result.thumbnailDeleted, false);
  assert.deepEqual(deleted, []);
});

test("the document-level guard overrules a refCount that says zero", async () => {
  reset();
  // Bookkeeping drift: refCount is 1 but two documents point at the key.
  rows.push({ _id: 1, hash: "h1", s3Path: "uploads/a/1.pdf", refCount: 1 });
  documentsByPath.set("uploads/a/1.pdf", ["doc-a", "doc-b"]);

  const result = await releaseStoredFile({
    documentId: "doc-a",
    fileHash: "h1",
    s3Path: "uploads/a/1.pdf",
  });

  assert.equal(result.deleted, false, "documents win over counters");
  assert.deepEqual(deleted, []);
});

test("releasing more times than claimed never goes negative or double-deletes", async () => {
  reset();
  await claimStoredFile({ hash: "h1", s3Path: "uploads/a/1.pdf", sizeBytes: 100 });
  deleted = [];

  await releaseStoredFile({ fileHash: "h1", s3Path: "uploads/a/1.pdf" });
  assert.deepEqual(deleted, ["uploads/a/1.pdf"]);

  // A retried delete, or a stale queue job.
  const again = await releaseStoredFile({
    fileHash: "h1",
    s3Path: "uploads/a/1.pdf",
  });
  assert.equal(again.refCount, 0);
  assert.ok(
    rows.every((row) => row.refCount >= 0),
    "refCount must never go negative"
  );
});

test("three owners, all released, object survives until the last one", async () => {
  reset();
  for (const owner of ["a", "b", "c"]) {
    await claimStoredFile({
      hash: "h1",
      s3Path: `uploads/${owner}/f.pdf`,
      sizeBytes: 10,
    });
  }
  const shared = "uploads/a/f.pdf";
  documentsByPath.set(shared, ["doc-a", "doc-b", "doc-c"]);
  deleted = [];

  const first = await releaseStoredFile({
    documentId: "doc-a",
    fileHash: "h1",
    s3Path: shared,
  });
  documentsByPath.set(shared, ["doc-b", "doc-c"]);

  const second = await releaseStoredFile({
    documentId: "doc-b",
    fileHash: "h1",
    s3Path: shared,
  });
  documentsByPath.set(shared, ["doc-c"]);

  assert.equal(first.deleted, false);
  assert.equal(second.deleted, false);
  assert.deepEqual(deleted, [], "still referenced");

  const third = await releaseStoredFile({
    documentId: "doc-c",
    fileHash: "h1",
    s3Path: shared,
  });
  assert.equal(third.deleted, true);
  assert.deepEqual(deleted, [shared]);
});
