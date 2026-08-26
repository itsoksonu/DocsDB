import Document from "../models/Document.js";
import DocumentDailyStat, { utcDay } from "../models/DocumentDailyStat.js";
import { getRedis } from "./redis.js";
import logger from "./logger.js";

/**
 * View and download counts used to be one findByIdAndUpdate per event, plus a
 * redisClient.keys() full-keyspace scan to decide whether the event was a
 * duplicate. Both are gone:
 *
 *   dedup   one SET NX EX per event - O(1), no scanning.
 *   counts  buffered in a Redis hash and flushed to Mongo in a single
 *           bulkWrite every FLUSH_INTERVAL_MS, so a document being hammered
 *           costs one write per interval instead of one write per view.
 *
 * The flush also rolls the same deltas into DocumentDailyStat, which is what
 * the admin insights view charts.
 *
 * Tradeoff: counts on Document lag by up to FLUSH_INTERVAL_MS, and an
 * ungraceful Redis loss drops at most that window of counts. Without Redis the
 * code falls straight through to a direct $inc, so correctness never depends on
 * the cache being up.
 */

const PENDING_KEY = "doc:counters:pending";
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_LOCK_KEY = "doc:counters:flushing";
const DEDUP_TTL_SECONDS = 300;

let flushTimer = null;

function field(documentId, metric, day) {
  return `${documentId}|${metric}|${day.toISOString().slice(0, 10)}`;
}

function parseField(raw) {
  const [documentId, metric, day] = raw.split("|");
  return { documentId, metric, day: new Date(`${day}T00:00:00.000Z`) };
}

/**
 * Returns true if this is a fresh event, false if the same viewer already
 * counted within the dedup window. Without Redis every event counts.
 */
export async function claimEvent(metric, documentId, viewerKey) {
  const redis = getRedis();
  if (!redis) return true;

  try {
    const key = `dedup:${metric}:${documentId}:${viewerKey}`;
    const claimed = await redis.set(key, "1", {
      NX: true,
      EX: DEDUP_TTL_SECONDS,
    });
    return claimed === "OK";
  } catch (error) {
    // Fail open: a Redis hiccup should not stop views from being counted.
    logger.error("Counter dedup failed, counting anyway:", error);
    return true;
  }
}

export async function incrementCounter(documentId, metric, amount = 1) {
  const redis = getRedis();
  const day = utcDay();

  if (!redis) {
    await applyDeltas([
      { documentId: String(documentId), metric, day, amount },
    ]);
    return;
  }

  try {
    await redis.hIncrBy(PENDING_KEY, field(documentId, metric, day), amount);
    scheduleFlush();
  } catch (error) {
    logger.error("Counter buffering failed, writing through:", error);
    await applyDeltas([
      { documentId: String(documentId), metric, day, amount },
    ]);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushCounters().catch((error) =>
      logger.error("Counter flush failed:", error)
    );
  }, FLUSH_INTERVAL_MS);
  // Never hold the process open just to flush counters.
  flushTimer.unref?.();
}

/**
 * Drains the pending hash into Mongo. Safe to call concurrently and from
 * multiple server instances: the hash is renamed under a short lock, so each
 * batch is claimed by exactly one flusher.
 */
export async function flushCounters() {
  const redis = getRedis();
  if (!redis) return { documents: 0 };

  const lock = await redis.set(FLUSH_LOCK_KEY, "1", { NX: true, EX: 30 });
  if (lock !== "OK") return { documents: 0 };

  const draining = `${PENDING_KEY}:draining:${Date.now()}`;

  try {
    try {
      await redis.rename(PENDING_KEY, draining);
    } catch {
      // Nothing pending.
      return { documents: 0 };
    }

    const pending = await redis.hGetAll(draining);
    const deltas = Object.entries(pending)
      .map(([raw, value]) => {
        const parsed = parseField(raw);
        return { ...parsed, amount: Number(value) };
      })
      .filter((d) => d.amount && Number.isFinite(d.amount));

    if (deltas.length === 0) return { documents: 0 };

    try {
      await applyDeltas(deltas);
    } catch (error) {
      // Put the counts back rather than losing them.
      const restore = redis.multi();
      for (const d of deltas) {
        restore.hIncrBy(PENDING_KEY, field(d.documentId, d.metric, d.day), d.amount);
      }
      await restore.exec();
      throw error;
    }

    return { documents: deltas.length };
  } finally {
    // The draining key carries a timestamp and no TTL, so every path out of
    // this function has to delete it. Deleting it here rather than around
    // applyDeltas also covers hGetAll throwing and the empty-deltas early
    // return, both of which used to leak a key holding real counter data.
    await redis.del(draining);
    await redis.del(FLUSH_LOCK_KEY);
  }
}

async function applyDeltas(deltas) {
  // Lifetime totals: one $inc per document, both metrics merged.
  const byDocument = new Map();
  for (const d of deltas) {
    const entry = byDocument.get(d.documentId) || {};
    const path = d.metric === "views" ? "viewsCount" : "downloadsCount";
    entry[path] = (entry[path] || 0) + d.amount;
    byDocument.set(d.documentId, entry);
  }

  const documentOps = [...byDocument.entries()].map(([documentId, inc]) => ({
    updateOne: {
      filter: { _id: documentId },
      update: { $inc: inc },
    },
  }));

  // Daily rollups: one upsert per document per day.
  const byDay = new Map();
  for (const d of deltas) {
    const key = `${d.documentId}|${d.day.toISOString()}`;
    const entry = byDay.get(key) || { documentId: d.documentId, day: d.day, inc: {} };
    entry.inc[d.metric] = (entry.inc[d.metric] || 0) + d.amount;
    byDay.set(key, entry);
  }

  const statOps = [...byDay.values()].map(({ documentId, day, inc }) => ({
    updateOne: {
      filter: { documentId, date: day },
      update: { $inc: inc, $setOnInsert: { documentId, date: day } },
      upsert: true,
    },
  }));

  await Promise.all([
    documentOps.length
      ? Document.bulkWrite(documentOps, { ordered: false })
      : null,
    statOps.length
      ? DocumentDailyStat.bulkWrite(statOps, { ordered: false })
      : null,
  ]);
}

/**
 * Lifetime totals on Document exclude anything still sitting in the buffer.
 * Read paths that must not look stale (the document page, admin insights) add
 * the pending delta back on.
 */
export async function pendingFor(documentId) {
  const redis = getRedis();
  if (!redis) return { views: 0, downloads: 0 };

  try {
    const pending = await redis.hGetAll(PENDING_KEY);
    const result = { views: 0, downloads: 0 };
    const prefix = `${documentId}|`;

    for (const [raw, value] of Object.entries(pending)) {
      if (!raw.startsWith(prefix)) continue;
      const { metric } = parseField(raw);
      result[metric] = (result[metric] || 0) + Number(value);
    }

    return result;
  } catch (error) {
    logger.error("Reading pending counters failed:", error);
    return { views: 0, downloads: 0 };
  }
}

// Called on shutdown so an intentional restart does not drop the buffer.
export async function stopCounters() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushCounters().catch((error) =>
    logger.error("Final counter flush failed:", error)
  );
}
