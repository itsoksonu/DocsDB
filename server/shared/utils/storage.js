import crypto from "crypto";
import fs from "fs";
import StoredFile from "../models/StoredFile.js";
import S3Manager from "./s3.js";
import logger from "./logger.js";

/**
 * Reference-counted S3 storage.
 *
 * Several Documents can point at one S3 object when their bytes are identical.
 * Every acquire and release goes through here so the object outlives every
 * document that references it, and no longer.
 */

/** SHA-256 of a file on disk, streamed so a 100MB PDF is not held in memory. */
export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * The one rule every delete in this file obeys: an object goes only when no
 * live document still points at that key.
 *
 * Asked of the documents collection, never inferred from a hash, a reference
 * count, or "this looks like our own upload". Every time that inference was
 * made instead, a file somebody still needed was destroyed.
 */
export async function deleteObjectIfUnreferenced({
  documentId,
  key,
  field = "s3Path",
}) {
  if (!key) return false;

  const Document = (await import("../models/Document.js")).default;

  const others = await Document.countDocuments({
    ...(documentId ? { _id: { $ne: documentId } } : {}),
    [field]: key,
    status: { $ne: "deleted" },
  });

  if (others > 0) {
    logger.info(`Kept ${key}: ${others} other document(s) still point at it`);
    return false;
  }

  await S3Manager.deleteObject(key).catch((error) =>
    logger.warn(`Failed to delete ${key}:`, error)
  );
  return true;
}

/**
 * Registers `s3Path` as the storage for `hash`, or joins the existing one.
 *
 * Returns the key the caller should actually use. When it differs from the key
 * passed in, the caller's own upload is redundant and has been removed.
 */
export async function claimStoredFile({ documentId, hash, s3Path, sizeBytes }) {
  // Atomic: increments an existing row or creates it at 1. Two documents
  // finishing processing at the same moment cannot both think they are first.
  const stored = await StoredFile.findOneAndUpdate(
    { hash },
    {
      $inc: { refCount: 1 },
      $setOnInsert: { hash, s3Path, sizeBytes },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // We created it, so this document's own object is the canonical one.
  if (stored.s3Path === s3Path) {
    return { s3Path, deduplicated: false, refCount: stored.refCount };
  }

  // Someone else's object is canonical. Point at theirs and drop ours - but
  // only if "ours" really is ours. On a reprocess of a document whose s3Path
  // was already repointed to a shared object, this key belongs to somebody
  // else, and deleting it would take their file with it.
  await deleteObjectIfUnreferenced({ documentId, key: s3Path });

  logger.info(
    `Deduplicated storage: ${s3Path} now points at ${stored.s3Path} (${stored.refCount} refs)`
  );

  return {
    s3Path: stored.s3Path,
    deduplicated: true,
    refCount: stored.refCount,
  };
}

/**
 * Gives up one document's claim on its storage.
 *
 * The rule that actually protects data is the last one: an object is deleted
 * only when no other live document points at that key. Reference counts are
 * bookkeeping and bookkeeping drifts - a document whose s3Path was repointed to
 * a shared object but whose fileHash never got persisted (a run that died
 * partway) looks unhashed, and "unhashed means it owns its file" was wrong
 * enough to delete a PDF another document was still using.
 */
export async function releaseStoredFile({
  documentId,
  fileHash,
  s3Path,
  thumbnailS3Path,
}) {

  // Decrement first so the count stays honest whatever we decide below.
  let refCount = 0;
  if (fileHash) {
    const stored = await StoredFile.findOneAndUpdate(
      { hash: fileHash, refCount: { $gt: 0 } },
      { $inc: { refCount: -1 } },
      { new: true }
    );
    refCount = stored?.refCount ?? 0;

    if (stored && stored.refCount <= 0) {
      await StoredFile.deleteOne({ _id: stored._id });
    }
  }

  // The authoritative check: is anything else still pointing at these bytes?
  // Asked of the documents themselves, not of a counter.
  //
  // The file and the thumbnail are checked separately. They are shared on
  // different terms: two documents can share one source object while each keeps
  // its own thumbnail, so bundling the two deletions leaks the thumbnail of
  // every document that gives up a shared file.
  const fileDeleted = await deleteObjectIfUnreferenced({
    documentId,
    key: s3Path,
    field: "s3Path",
  });
  const thumbnailDeleted = await deleteObjectIfUnreferenced({
    documentId,
    key: thumbnailS3Path,
    field: "thumbnailS3Path",
  });

  return {
    deleted: fileDeleted,
    thumbnailDeleted,
    refCount,
    referencedBy: fileDeleted ? 0 : 1,
  };
}
