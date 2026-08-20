/**
 * Migration runner.
 *
 *   npm run migrate -- 005 <step> [--dry-run] [--force]
 *   npm run migrate -- list
 *
 * The one-shot migrations that normalized users, backfilled slugs, rebuilt
 * thumbnails and recovered untitled documents have all been applied to
 * production and were removed. What is left is 005, which is not a one-shot:
 * `audit` is the only thing that can tell you whether every document's file is
 * still present in S3, and `repair` marks the ones that are not.
 */

import mongoose from "mongoose";
import databaseManager from "./connection.js";

import * as dedupeStorage from "./migrations/005-dedupe-storage.js";

const MIGRATIONS = {
  [dedupeStorage.name]: dedupeStorage,
  "005": dedupeStorage,
};

function usage() {
  console.log("Usage: npm run migrate -- 005 <step> [--dry-run] [--force]");
  console.log("");
  console.log("  005-dedupe-storage");
  console.log("    audit      report documents whose S3 object is missing");
  console.log("    repair     mark those documents failed so owners can re-upload");
  console.log("    versioning show whether the bucket keeps previous versions");
  console.log("    restore    restore missing objects from a previous version");
  console.log("    indexes    drop the legacy unique fileHash index");
  console.log("    backfill   hash documents that have no fileHash yet");
  console.log("    report     summarise duplicate groups without changing anything");
  console.log("    reclaim    point duplicates at one object and free the rest");
  console.log("");
  console.log("Health check, safe to run any time:");
  console.log("  npm run migrate -- 005 audit");
}

async function main() {
  const [, , migrationKey, step, ...flags] = process.argv;

  if (!migrationKey || migrationKey === "list" || migrationKey === "--help") {
    usage();
    return;
  }

  const migration = MIGRATIONS[migrationKey];
  if (!migration) {
    console.error(`Unknown migration: ${migrationKey}`);
    usage();
    process.exitCode = 1;
    return;
  }

  if (!step || typeof migration[step] !== "function") {
    console.error(`Unknown step "${step}" for ${migration.name}`);
    usage();
    process.exitCode = 1;
    return;
  }

  const options = {
    dryRun: flags.includes("--dry-run"),
    force: flags.includes("--force"),
    includePermanent: flags.includes("--include-permanent"),
  };

  await databaseManager.connectMongo();

  try {
    await migration[step](options);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  mongoose.disconnect();
});
