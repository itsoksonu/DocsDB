/**
 * Hashes existing documents and reports what storage is being paid for twice.
 *
 * Deliberately split so nothing is deleted on the strength of a policy whose
 * output you have not seen:
 *
 *   backfill  Downloads each document, records its SHA-256, and builds the
 *             StoredFile rows. Adds data, deletes nothing.
 *   report    Lists duplicate groups and the reclaimable bytes. Read-only.
 *   reclaim   Collapses each group onto one S3 object and removes the rest.
 *             Refuses to run until backfill has covered everything.
 *
 *   npm run migrate -- 005 backfill --dry-run
 *   npm run migrate -- 005 backfill
 *   npm run migrate -- 005 report
 *   npm run migrate -- 005 reclaim --dry-run
 *   npm run migrate -- 005 reclaim
 */

import Document from "../../models/Document.js";
import StoredFile from "../../models/StoredFile.js";
import S3Manager from "../../utils/s3.js";

export const name = "005-dedupe-storage";

const CONCURRENCY = 4;

// Deleted documents keep no claim on storage.
const LIVE = { status: { $nin: ["deleted", "duplicate"] } };

const NEEDS_HASH = {
  ...LIVE,
  s3Path: { $exists: true, $nin: [null, ""] },
  $or: [{ fileHash: { $exists: false } }, { fileHash: null }, { fileHash: "" }],
};

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Math.round(value * 10) / 10} ${units[unit]}`;
}

async function hashWorker(queue, stats, log) {
  for (;;) {
    const document = queue.pop();
    if (!document) return;

    try {
      // Hashing needs the bytes, and S3 is the only place they exist.
      const buffer = await S3Manager.getObjectBuffer(document.s3Path);
      const hash = (await import("crypto"))
        .createHash("sha256")
        .update(buffer)
        .digest("hex");

      await Document.updateOne(
        { _id: document._id },
        { $set: { fileHash: hash } }
      );

      stats.hashed += 1;
      if (stats.hashed % 25 === 0) log(`[${name}] hashed ${stats.hashed}`);
    } catch (error) {
      stats.failed += 1;
      stats.errors.push(`${document._id}: ${error.message}`);
    }
  }
}

/**
 * Reports whether the bucket keeps old versions, which decides whether an
 * accidental delete is recoverable at all.
 */
export async function versioning({ log = console.log } = {}) {
  const { S3Client, GetBucketVersioningCommand } = await import(
    "@aws-sdk/client-s3"
  );

  const client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const bucket = process.env.S3_BUCKET_NAME;
  const result = await client.send(
    new GetBucketVersioningCommand({ Bucket: bucket })
  );

  const status = result.Status || "Disabled";
  log(`[${name}] bucket ${bucket}: versioning is ${status}`);

  if (status === "Enabled") {
    log(`[${name}] deleted objects are recoverable - run:`);
    log(`[${name}]   npm run migrate -- 005 restore --dry-run`);
  } else {
    log(`[${name}] deleted objects are NOT recoverable from S3.`);
    log(`[${name}] Consider enabling versioning before any future cleanup.`);
  }

  return { bucket, status };
}

/**
 * Undeletes objects by removing their delete markers.
 *
 * S3 does not really delete a versioned object; it lays a delete marker on top.
 * Removing the marker brings the previous version back. Only markers that are
 * the current version are touched, and only recent ones, so this cannot disturb
 * anything that was deleted deliberately long ago.
 *
 *   npm run migrate -- 005 restore --dry-run
 *   npm run migrate -- 005 restore
 */
export async function restore({
  dryRun = false,
  hours = 24,
  log = console.log,
} = {}) {
  const { S3Client, ListObjectVersionsCommand, DeleteObjectCommand } =
    await import("@aws-sdk/client-s3");

  const { status, bucket } = await versioning({ log: () => {} });

  if (status !== "Enabled") {
    throw new Error(
      `[${name}] versioning is ${status} on ${bucket}; there is nothing to restore from.`
    );
  }

  const client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  log(`[${name}] looking for objects deleted since ${since.toISOString()}`);

  const markers = [];
  let keyMarker;
  let versionIdMarker;

  do {
    const page = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: "uploads/",
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      })
    );

    for (const marker of page.DeleteMarkers || []) {
      // IsLatest means the object currently reads as deleted. A marker buried
      // under newer versions is history, not a live deletion.
      if (marker.IsLatest && new Date(marker.LastModified) >= since) {
        markers.push(marker);
      }
    }

    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker || versionIdMarker);

  log(`[${name}] ${markers.length} object(s) can be restored`);

  if (dryRun) {
    for (const marker of markers.slice(0, 80)) {
      log(`[${name}]   ${marker.Key}`);
    }
    if (markers.length > 80) log(`[${name}]   ...and ${markers.length - 80} more`);
    log(`[${name}] dry run - nothing changed`);
    return { found: markers.length, restored: 0 };
  }

  let restored = 0;
  const problems = [];

  for (const marker of markers) {
    try {
      // Deleting the delete marker is what brings the object back.
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: marker.Key,
          VersionId: marker.VersionId,
        })
      );
      restored += 1;
    } catch (error) {
      problems.push(`${marker.Key}: ${error.message}`);
    }
  }

  log(`[${name}] restored ${restored} object(s), ${problems.length} problem(s)`);
  for (const problem of problems.slice(0, 20)) log(`[${name}]   ${problem}`);

  if (restored > 0) {
    log(`[${name}] now confirm with: npm run migrate -- 005 audit`);
  }

  return { found: markers.length, restored, problems: problems.length };
}

/**
 * Drops the old unique index on fileHash.
 *
 * This has to happen BEFORE the deduplicating code goes live. Changing the
 * schema does not change the database: Mongoose leaves an existing index alone
 * until something explicitly syncs it, so the unique constraint stays in force
 * and the second document to share a hash dies with E11000 at save time -
 * losing its whole processing run.
 *
 * Safe and idempotent: run it as many times as you like.
 */
export async function indexes({ log = console.log } = {}) {
  const existing = await Document.collection.indexes();
  const fileHashIndex = existing.find((index) => index.name === "fileHash_1");

  if (!fileHashIndex) {
    log(`[${name}] no fileHash_1 index present`);
  } else if (fileHashIndex.unique) {
    await Document.collection.dropIndex("fileHash_1");
    log(`[${name}] dropped the unique fileHash_1 index`);
  } else {
    log(`[${name}] fileHash_1 is already non-unique`);
  }

  await Document.syncIndexes();
  log(`[${name}] indexes synced`);

  const after = await Document.collection.indexes();
  const rebuilt = after.find((index) => index.name === "fileHash_1");
  log(
    `[${name}] fileHash_1 unique: ${Boolean(rebuilt?.unique)} (must be false)`
  );

  return { unique: Boolean(rebuilt?.unique) };
}

export async function backfill({ dryRun = false, log = console.log } = {}) {
  const total = await Document.countDocuments(NEEDS_HASH);
  log(`[${name}] ${total} document(s) need hashing`);

  if (dryRun || total === 0) {
    return { total, hashed: 0 };
  }

  // The unique index on fileHash has to be gone before two documents can share
  // a hash, otherwise the second update throws E11000.
  await indexes({ log });

  const documents = await Document.find(NEEDS_HASH).select("_id s3Path").lean();
  const stats = { hashed: 0, failed: 0, errors: [] };
  const queue = [...documents];

  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => hashWorker(queue, stats, log))
  );

  log(`[${name}] hashed ${stats.hashed}, failed ${stats.failed}`);
  for (const error of stats.errors.slice(0, 20)) log(`[${name}]   ${error}`);

  // Rebuild StoredFile from scratch so refCounts match reality exactly.
  await rebuildStoredFiles({ log });

  return stats;
}

/**
 * Recomputes every StoredFile row from the documents that reference it. Safe to
 * re-run: it is derived state, never a source of truth.
 */
async function rebuildStoredFiles({ log = console.log } = {}) {
  const groups = await Document.aggregate([
    { $match: { ...LIVE, fileHash: { $nin: [null, ""] } } },
    {
      $group: {
        _id: "$fileHash",
        // Oldest document's object becomes canonical.
        canonical: { $first: "$s3Path" },
        sizeBytes: { $first: "$sizeBytes" },
        refCount: { $sum: 1 },
      },
    },
  ]).option({ allowDiskUse: true });

  const operations = groups.map((group) => ({
    updateOne: {
      filter: { hash: group._id },
      update: {
        $set: { refCount: group.refCount, sizeBytes: group.sizeBytes || 0 },
        $setOnInsert: { hash: group._id, s3Path: group.canonical },
      },
      upsert: true,
    },
  }));

  if (operations.length) {
    await StoredFile.bulkWrite(operations, { ordered: false });
  }

  log(`[${name}] StoredFile rows rebuilt for ${groups.length} distinct file(s)`);
  return groups.length;
}

/**
 * Checks that every live document's S3 object actually exists.
 *
 * Worth running after anything that deletes storage. An earlier version of
 * releaseStoredFile inferred "this document has no fileHash, so it owns its
 * file" - which is false for a document that was repointed at a shared object
 * by a run that then died before persisting the hash. That deleted a PDF a
 * second document was still using.
 *
 * Read-only.
 */
export async function audit({ log = console.log } = {}) {
  const documents = await Document.find({
    status: { $nin: ["deleted", "duplicate"] },
    s3Path: { $exists: true, $nin: [null, ""] },
  })
    .select("_id s3Path thumbnailS3Path generatedTitle userId status")
    .lean();

  log(`[${name}] checking ${documents.length} document(s)`);

  const missingFile = [];
  const missingThumbnail = [];
  let checked = 0;

  const queue = [...documents];

  const worker = async () => {
    for (;;) {
      const document = queue.pop();
      if (!document) return;

      if (!(await S3Manager.objectExists(document.s3Path))) {
        missingFile.push(document);
      } else if (
        document.thumbnailS3Path &&
        !(await S3Manager.objectExists(document.thumbnailS3Path))
      ) {
        missingThumbnail.push(document);
      }

      checked += 1;
      if (checked % 100 === 0) log(`[${name}] checked ${checked}/${documents.length}`);
    }
  };

  await Promise.all(Array.from({ length: 8 }, worker));

  log("");
  log(`[${name}] ${missingFile.length} document(s) point at a missing S3 object`);
  log(`[${name}] ${missingThumbnail.length} document(s) are missing only a thumbnail`);

  for (const document of missingFile) {
    log(
      `[${name}]   MISSING FILE ${document._id}  "${document.generatedTitle || "(untitled)"}"`
    );
    log(`[${name}]                ${document.s3Path}`);
  }

  if (missingFile.length > 0) {
    log("");
    log(`[${name}] These cannot be regenerated. If S3 versioning is enabled on`);
    log(`[${name}] the bucket the previous version can be restored; otherwise the`);
    log(`[${name}] owner has to re-upload. Mark them failed so the UI offers that:`);
    log(`[${name}]   npm run migrate -- 005 repair`);
  }

  return { checked, missingFile, missingThumbnail };
}

/**
 * Marks documents whose object is gone as failed, so the owner sees a real
 * message and a re-upload prompt instead of a viewer that silently breaks.
 */
export async function repair({ dryRun = false, log = console.log } = {}) {
  const { missingFile, missingThumbnail } = await audit({ log });

  if (dryRun) {
    log(`[${name}] dry run - would mark ${missingFile.length} document(s) failed`);
    return { marked: 0 };
  }

  if (missingFile.length > 0) {
    await Document.updateMany(
      { _id: { $in: missingFile.map((document) => document._id) } },
      {
        $set: {
          status: "failed",
          processingError:
            "The stored file is missing. Please upload this document again.",
        },
      }
    );
    log(`[${name}] marked ${missingFile.length} document(s) as failed`);
  }

  // A missing thumbnail is recoverable from the file itself.
  for (const document of missingThumbnail) {
    log(`[${name}] thumbnail missing for ${document._id} - regenerate it from the admin page`);
  }

  return { marked: missingFile.length, thumbnails: missingThumbnail.length };
}

export async function report({ log = console.log } = {}) {
  const unhashed = await Document.countDocuments(NEEDS_HASH);
  if (unhashed > 0) {
    log(
      `[${name}] note: ${unhashed} document(s) are unhashed - if 005 audit lists them as` +
        ` missing from storage that is expected and they are excluded below`
    );
  }

  const groups = await Document.aggregate([
    { $match: { ...LIVE, fileHash: { $nin: [null, ""] } } },
    {
      $group: {
        _id: "$fileHash",
        count: { $sum: 1 },
        sizeBytes: { $first: "$sizeBytes" },
        owners: { $addToSet: "$userId" },
        paths: { $addToSet: "$s3Path" },
        titles: { $push: "$generatedTitle" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]).option({ allowDiskUse: true });

  // Only copies beyond the first are waste, and only when they are separate
  // objects - documents already sharing a key cost nothing extra.
  let reclaimable = 0;
  let redundantObjects = 0;

  for (const group of groups) {
    const extraObjects = group.paths.length - 1;
    redundantObjects += extraObjects;
    reclaimable += extraObjects * (group.sizeBytes || 0);
  }

  log(`[${name}] ${groups.length} file(s) exist in more than one document`);
  log(`[${name}] ${redundantObjects} redundant S3 object(s), ${formatBytes(reclaimable)} reclaimable`);
  log("");

  for (const group of groups.slice(0, 25)) {
    const scope = group.owners.length === 1 ? "same owner" : `${group.owners.length} owners`;
    log(
      `[${name}] ${group.count}x  ${formatBytes(group.sizeBytes || 0)}  ${scope}  ${group.paths.length} object(s)`
    );
    log(`[${name}]       ${group.titles.filter(Boolean)[0] || "(untitled)"}`);
  }
  if (groups.length > 25) log(`[${name}] ...and ${groups.length - 25} more`);

  return { groups: groups.length, redundantObjects, reclaimable };
}

export async function reclaim({ dryRun = false, log = console.log } = {}) {
  // The guard exists so a document whose bytes were never hashed cannot have
  // its storage treated as unreferenced. A document whose object does not
  // exist has no storage to protect, and can never be hashed, so counting it
  // here just deadlocks: backfill can't fix it and reclaim won't run without it.
  const unhashed = await Document.find(NEEDS_HASH)
    .select("_id s3Path")
    .lean();

  const blocking = [];
  for (const document of unhashed) {
    if (await S3Manager.objectExists(document.s3Path)) {
      blocking.push(document);
    }
  }

  if (unhashed.length > blocking.length) {
    log(
      `[${name}] ignoring ${unhashed.length - blocking.length} unhashed document(s) whose file is already missing`
    );
  }

  if (blocking.length > 0 && !dryRun) {
    throw new Error(
      `[${name}] ${blocking.length} document(s) have a file in storage but no hash. ` +
        `Run backfill first, otherwise their storage would be treated as unreferenced.`
    );
  }

  const groups = await Document.aggregate([
    { $match: { ...LIVE, fileHash: { $nin: [null, ""] } } },
    {
      $group: {
        _id: "$fileHash",
        paths: { $addToSet: "$s3Path" },
        sizeBytes: { $first: "$sizeBytes" },
        oldest: { $min: "$createdAt" },
      },
    },
    { $match: { "paths.1": { $exists: true } } },
  ]).option({ allowDiskUse: true });

  log(`[${name}] ${groups.length} group(s) hold more than one copy of the same bytes`);

  if (dryRun) {
    let bytes = 0;
    for (const group of groups) {
      bytes += (group.paths.length - 1) * (group.sizeBytes || 0);
      log(`[${name}]   ${group.paths.length} objects -> 1  (${formatBytes(group.sizeBytes || 0)} each)`);
    }
    log(`[${name}] dry run - would free ${formatBytes(bytes)}`);
    return { groups: groups.length, freed: bytes };
  }

  let freed = 0;
  let removed = 0;
  const problems = [];

  for (const group of groups) {
    // Prefer the oldest document's object, but only if it is actually there.
    //
    // Choosing a canonical without checking is how this migration destroyed a
    // second file: an earlier bug had already deleted the oldest document's
    // object, reclaim picked that dead key anyway, repointed the whole group at
    // it and then deleted the one surviving copy.
    const ordered = await Document.find({ ...LIVE, fileHash: group._id })
      .sort({ createdAt: 1 })
      .select("s3Path")
      .lean();

    const seen = new Set();
    const candidates = ordered
      .map((document) => document.s3Path)
      .filter((path) => path && !seen.has(path) && seen.add(path));

    let canonical = null;
    for (const path of candidates) {
      if (await S3Manager.objectExists(path)) {
        canonical = path;
        break;
      }
    }

    if (!canonical) {
      problems.push(
        `${group._id}: every copy is already missing from storage, left untouched`
      );
      continue;
    }

    // Point every document in the group at the canonical object BEFORE any
    // deletion, so an interruption leaves documents readable rather than
    // pointing at an object that no longer exists.
    await Document.updateMany(
      { ...LIVE, fileHash: group._id },
      { $set: { s3Path: canonical } }
    );

    await StoredFile.updateOne(
      { hash: group._id },
      { $set: { s3Path: canonical } }
    );

    // Re-confirm the canonical survives right before removing anything else.
    // Deleting the last copy of a file to save space is not a trade worth
    // making on the strength of a check made several statements ago.
    if (!(await S3Manager.objectExists(canonical))) {
      problems.push(
        `${group._id}: canonical ${canonical} vanished mid-run, nothing deleted`
      );
      continue;
    }

    for (const path of group.paths) {
      if (path === canonical) continue;

      try {
        await S3Manager.deleteObject(path);
        freed += group.sizeBytes || 0;
        removed += 1;
      } catch (error) {
        problems.push(`${path}: ${error.message}`);
      }
    }
  }

  await rebuildStoredFiles({ log });

  log(`[${name}] removed ${removed} redundant object(s), freed ${formatBytes(freed)}`);
  for (const problem of problems.slice(0, 20)) log(`[${name}]   ${problem}`);

  return { removed, freed, problems: problems.length };
}
