import { GoogleGenAI } from "@google/genai";
import Document from "../models/Document.js";
import DocumentChunk from "../models/DocumentChunk.js";
import { extractDocumentSegments, forgetUnreadable } from "./documentText.js";
import { getEmbeddingModel } from "./aiSettings.js";
import logger from "./logger.js";

/**
 * Retrieval for Ask AI.
 *
 * A question can only be answered from text that was actually sent to the
 * model, and a provider's context window is a few thousand characters wide -
 * far less than a book. Sending the opening section and hoping the answer is in
 * it is the thing this replaces: the document is split into passages once,
 * embedded once, and each question pulls back the passages that are actually
 * about it.
 *
 * Two shapes come out of here:
 *   "full"      the whole document fits in the budget, so nothing is selected
 *               and nothing can be missed. No embeddings needed at all.
 *   "retrieved" the passages closest to the question, in reading order.
 *
 * Similarity is computed in this process rather than with Atlas $vectorSearch
 * (which the cross-document search uses). Retrieval here is always scoped to
 * one document - a few hundred vectors - so an approximate-nearest-neighbour
 * index would add an Atlas index to maintain and change nothing measurable.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// v1 rather than the default: the same pinning documentProcessor uses for
// embeddings, because the embedding endpoint moved.
const geminiEmbeddingAI = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      httpOptions: { apiVersion: "v1" },
    })
  : null;

// Passage size. Big enough to hold a whole argument, small enough that a dozen
// of them fit in the context budget.
const CHUNK_CHARS = 1400;
// Carried from the end of the previous passage, so a sentence split across a
// boundary is still complete in one of them.
const CHUNK_OVERLAP = 200;
// Look this far back from a boundary for a paragraph or sentence break.
const BOUNDARY_WINDOW = 300;

const MAX_CHUNKS = 500;

// The line between "send the whole document" and "retrieve from it", and the
// cap on how much is sent when a document has no usable embeddings.
export const CONTEXT_BUDGET_CHARS = 20_000;

// How much retrieved text one answer may be built from - lower, because every
// character is prefill the user waits through, and fourteen passages was mostly
// spending that wait on passages the answer never used. Kept separate from the
// threshold above so which documents get indexed does not change.
const RETRIEVAL_BUDGET_CHARS = 14_000;

// Passages per answer. The budget usually binds first; this stops a document of
// tiny passages from turning into fifty citations.
const MAX_RETRIEVED_CHUNKS = 10;

// Gemini accepts a batch per request; 32 keeps each payload well clear of the
// request size limit while cutting a 400-passage document to 13 round trips.
// It does not help the free tier's quota, which is counted per passage.
const EMBED_BATCH = 32;

// How long one queued embedding pass runs before reporting back. A 264-page
// document is 345 passages against a 100-per-minute quota, so it takes several
// passes whatever we do; the job is retried until it is done.
const EMBED_PASS_BUDGET_MS = 60_000;

// Shown in the sources list; the model still sees the whole passage.
const SNIPPET_CHARS = 400;

// Bumped when the stored shape of a passage changes. An index written in an
// older format is dropped and rebuilt on the next question instead of being
// read wrongly: 1 stored vectors as BSON arrays of doubles, 2 as Float32
// binary.
const INDEX_FORMAT = 2;

// Repeat questions are common - the same suggestion clicked twice, a follow-up
// re-asked - and each was a round trip of the better part of a second to embed
// a string we had embedded already. 100 vectors is a couple of megabytes.
const MAX_CACHED_QUERIES = 100;

/**
 * Float32 binary, the way DocumentChunk.embedding is stored.
 *
 * Endianness is the platform's, which is fine: the same servers write and read,
 * and every architecture this runs on is little-endian.
 */
function encodeVector(values) {
  const floats = Float32Array.from(values);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

function decodeVector(stored) {
  if (!stored) return null;

  // Mongoose hands back a Buffer for a lean read; a non-lean document can carry
  // the driver's Binary wrapper instead.
  const bytes = Buffer.isBuffer(stored)
    ? stored
    : stored.buffer
      ? Buffer.from(stored.buffer)
      : null;

  if (!bytes?.byteLength) return null;

  // A Node Buffer is a view into a shared pool, and its byteOffset is not
  // necessarily a multiple of 4 - which Float32Array refuses. slice() copies
  // the bytes into a fresh, aligned ArrayBuffer.
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

/** Splits one segment's text into overlapping passages at natural breaks. */
function chunkSegment(text, label, chunks) {
  let cursor = 0;

  while (cursor < text.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(cursor + CHUNK_CHARS, text.length);

    if (end < text.length) {
      const window = text.slice(end - BOUNDARY_WINDOW, end);
      // A paragraph break is the best place to cut, a sentence end the next
      // best; failing both, cut mid-sentence rather than lose the text.
      const paragraph = window.lastIndexOf("\n");
      const sentence = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
      );
      const offset = paragraph >= 0 ? paragraph : sentence >= 0 ? sentence + 1 : -1;
      if (offset >= 0) end = end - BOUNDARY_WINDOW + offset + 1;
    }

    const passage = text.slice(cursor, end).trim();
    if (passage) chunks.push({ index: chunks.length, label, text: passage });

    if (end >= text.length) break;
    cursor = Math.max(end - CHUNK_OVERLAP, cursor + 1);
  }

  return chunks;
}

export function chunkSegments(segments) {
  const chunks = [];

  for (const segment of segments) {
    if (chunks.length >= MAX_CHUNKS) break;
    chunkSegment(segment.text, segment.label || null, chunks);
  }

  return chunks;
}

async function embedBatch(texts, model) {
  const response = await geminiEmbeddingAI.models.embedContent({
    model,
    contents: texts.map((text) => ({ parts: [{ text }] })),
  });

  const embeddings = response?.embeddings || [];
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Expected ${texts.length} embeddings, got ${embeddings.length}`,
    );
  }

  return embeddings.map((embedding) => {
    const values = embedding?.values;
    if (!values?.length) throw new Error("Empty embedding returned");
    return values;
  });
}

async function embedTexts(texts, model) {
  const vectors = [];

  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    vectors.push(
      ...(await embedBatch(texts.slice(start, start + EMBED_BATCH), model)),
    );
  }

  return vectors;
}

/** The question's own vector, remembered so asking the same thing is free. */
const queryCache = new Map();

async function embedQuery(query, model) {
  const key = `${model}:${query}`;

  const cached = queryCache.get(key);
  if (cached) {
    // Re-inserting moves it to the end; the front of a Map is the oldest.
    queryCache.delete(key);
    queryCache.set(key, cached);
    return { vector: cached, cached: true };
  }

  const [values] = await embedTexts([query], model);
  const vector = Float32Array.from(values);

  queryCache.set(key, vector);
  if (queryCache.size > MAX_CACHED_QUERIES) {
    queryCache.delete(queryCache.keys().next().value);
  }

  return { vector, cached: false };
}

function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return total;
}

function magnitude(vector) {
  return Math.sqrt(dot(vector, vector));
}

// The chunk's magnitude is computed once when it is cached, so scoring a
// question against a few hundred passages is a few hundred dot products.
function similarity(query, queryMagnitude, chunk) {
  const chunkMagnitude = chunk.norm || magnitude(chunk.embedding);
  if (!queryMagnitude || !chunkMagnitude) return 0;
  return dot(query, chunk.embedding) / (queryMagnitude * chunkMagnitude);
}

/**
 * Passages held in this process, so a second question about the same document
 * does not pull every vector back out of Atlas.
 *
 * The chunks are immutable once written - only a reprocess replaces them, and
 * that clears this - so there is nothing to keep in sync. Vectors are stored as
 * Float32Array: a quarter of the memory of a JS number array, and faster to
 * scan. Least-recently-used entries are evicted at the ceiling below, which is
 * deliberately small enough to be safe on a 512 MB instance.
 *
 * Per instance, and not shared: a reprocess clears the cache on the instance
 * that handled it, and other instances keep theirs until eviction. That is
 * harmless because reprocessing re-reads the same immutable S3 bytes and
 * produces the same passages; a deploy that changes extraction restarts every
 * process anyway.
 */
const MAX_CACHED_FLOATS = 4_000_000; // ~16 MB of Float32

const passageCache = new Map();
let cachedFloats = 0;

function cacheKeyFor(documentId, model) {
  return `${documentId}:${model || "none"}`;
}

function readCache(key) {
  const entry = passageCache.get(key);
  if (!entry) return null;

  // Re-inserting moves it to the end; the front of a Map is the oldest entry.
  passageCache.delete(key);
  passageCache.set(key, entry);
  return entry.passages;
}

function writeCache(key, passages) {
  const floats = passages.reduce(
    (total, passage) => total + (passage.embedding?.length || 0),
    0,
  );

  // One document larger than the whole budget would evict everything and then
  // itself; it is simply not cached.
  if (floats > MAX_CACHED_FLOATS) return;

  const existing = passageCache.get(key);
  if (existing) cachedFloats -= existing.floats;

  passageCache.set(key, { passages, floats });
  cachedFloats += floats;

  while (cachedFloats > MAX_CACHED_FLOATS && passageCache.size > 1) {
    const [oldestKey, oldest] = passageCache.entries().next().value;
    passageCache.delete(oldestKey);
    cachedFloats -= oldest.floats;
  }
}

function dropFromCache(documentId) {
  const prefix = `${documentId}:`;

  for (const [key, entry] of passageCache) {
    if (key.startsWith(prefix)) {
      passageCache.delete(key);
      cachedFloats -= entry.floats;
    }
  }
}

/**
 * One piece of work per key, however many callers want it.
 *
 * The panel warms a document's index the moment it is opened, and a user who
 * clicks a suggestion two seconds later arrives while that is still running.
 * Without this they each extract, embed and load the same document in full -
 * which is exactly what the logs showed: two consecutive cache misses and the
 * same four-second load paid twice.
 */
const inFlight = new Map();

function singleFlight(key, work) {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => work())().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/**
 * Every passage of a document, in reading order, from cache when possible.
 *
 * @returns {Promise<{passages: Array, cache: "hit"|"shared"|"miss"}>}
 */
async function loadPassages(documentId, model) {
  const key = cacheKeyFor(documentId, model);

  const cached = readCache(key);
  if (cached) return { passages: cached, cache: "hit" };

  let shared = true;

  const passages = await singleFlight(`load:${key}`, async () => {
    shared = false;

    // A concurrent caller may have filled the cache while we queued.
    const filled = readCache(key);
    if (filled) return filled;

    const query = DocumentChunk.find({ documentId }).sort({ index: 1 });
    // Vectors are only worth transferring when they will be searched.
    const rows = await (model
      ? query.select("+embedding index label text")
      : query.select("index label text")
    ).lean();

    const loaded = rows.map((row) => {
      const embedding = decodeVector(row.embedding);

      return {
        index: row.index,
        label: row.label || null,
        text: row.text,
        embedding,
        norm: embedding ? magnitude(embedding) : 0,
      };
    });

    writeCache(key, loaded);
    return loaded;
  });

  return { passages, cache: shared ? "shared" : "miss" };
}

/**
 * Splits and stores the document's passages. Text only - embedding is a
 * separate, resumable pass.
 *
 * A 264-page PDF is 345 passages, and the free embedding tier allows 100
 * requests a minute (counted per passage, so batching does not help). Embedding
 * inside this call meant a question waited 102 seconds, hit the quota, threw
 * away every vector it had already paid for, and answered from the opening
 * section anyway - which was available immediately.
 */
async function buildIndex(document) {
  const extracted = await extractDocumentSegments(document);
  if (!extracted) return null;

  const chunks = chunkSegments(extracted.segments);
  if (!chunks.length) return null;

  try {
    await DocumentChunk.insertMany(
      chunks.map((chunk) => ({
        documentId: document._id,
        index: chunk.index,
        text: chunk.text,
        label: chunk.label,
      })),
      { ordered: false },
    );
  } catch (error) {
    // Two first questions raced. The unique {documentId, index} index means one
    // insert won; that index is as good as this one, so use it.
    if (error.code !== 11000 && !error.writeErrors) throw error;
    logger.info(`Ask AI: chunk index for ${document._id} was already written`);
  }

  const aiIndex = {
    chunkCount: chunks.length,
    totalChars: extracted.totalChars,
    truncated: extracted.truncated || chunks.length >= MAX_CHUNKS,
    builtAt: new Date(),
    format: INDEX_FORMAT,
  };

  await Document.updateOne({ _id: document._id }, { $set: { aiIndex } });

  // The text is already in hand, so the first question reads it from here
  // rather than from the collection it was just written to.
  writeCache(
    cacheKeyFor(document._id, null),
    chunks.map((chunk) => ({
      index: chunk.index,
      label: chunk.label,
      text: chunk.text,
      embedding: null,
      norm: 0,
    })),
  );

  return aiIndex;
}

function isQuotaError(error) {
  const message = String(error?.message || "");
  return (
    error?.status === 429 ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("429")
  );
}

/**
 * Embeds the passages that do not have a vector yet, saving each batch as it
 * lands.
 *
 * Resumable on purpose. On a rate-limited tier a long document cannot be
 * embedded in one pass, and the previous version discarded everything it had
 * done when the quota ran out - so it never got further than the first minute's
 * worth, however many times it tried. Now the work accumulates and a later pass
 * picks up where this one stopped.
 *
 * @returns {Promise<{complete: boolean, embedded: number, remaining: number}>}
 */
async function embedPending(document, embeddingModel, deadline) {
  const pending = await DocumentChunk.find({
    documentId: document._id,
    embedding: { $exists: false },
  })
    .select("index text")
    .sort({ index: 1 })
    .lean();

  if (!pending.length) return { complete: true, embedded: 0, remaining: 0 };

  let embedded = 0;

  for (let start = 0; start < pending.length; start += EMBED_BATCH) {
    if (Date.now() > deadline) {
      logger.info(
        `Ask AI: embedded ${embedded} of ${pending.length} passages of ${document._id} before the time budget ran out`,
      );
      break;
    }

    const batch = pending.slice(start, start + EMBED_BATCH);

    let vectors;
    try {
      vectors = await embedBatch(
        batch.map((chunk) => chunk.text),
        embeddingModel,
      );
    } catch (error) {
      if (isQuotaError(error)) {
        // Expected on a free tier, not a fault: keep what we have and stop.
        logger.warn(
          `Ask AI: embedding quota reached after ${embedded} of ${pending.length} passages of ${document._id}; the rest will follow`,
        );
        break;
      }
      throw error;
    }

    await DocumentChunk.bulkWrite(
      batch.map((chunk, position) => ({
        updateOne: {
          filter: { _id: chunk._id },
          update: { $set: { embedding: encodeVector(vectors[position]) } },
        },
      })),
    );

    embedded += batch.length;
  }

  const remaining = pending.length - embedded;

  if (!remaining) {
    logger.info(
      `Ask AI: ${document._id} fully embedded (${embedded} new passages, ${embeddingModel})`,
    );
  }

  return { complete: remaining === 0, embedded, remaining };
}

/**
 * The passages closest to the question, in reading order and within budget.
 * Separated from the query above so the selection rules can be tested without
 * a database.
 */
export function selectChunks(chunks, queryVector) {
  const queryMagnitude = magnitude(queryVector);

  const scored = chunks
    .filter((chunk) => chunk.embedding?.length === queryVector.length)
    .map((chunk) => ({
      ...chunk,
      score: similarity(queryVector, queryMagnitude, chunk),
    }))
    .sort((a, b) => b.score - a.score);

  const picked = [];
  let used = 0;

  for (const chunk of scored) {
    if (picked.length >= MAX_RETRIEVED_CHUNKS) break;
    if (used + chunk.text.length > RETRIEVAL_BUDGET_CHARS) continue;
    picked.push(chunk);
    used += chunk.text.length;
  }

  // Reading order, so the model sees the argument in the order it was written.
  return picked.sort((a, b) => a.index - b.index);
}

/** The opening passages, for documents with no usable embeddings. */
function takeFromStart(passages) {
  const picked = [];
  let used = 0;

  for (const passage of passages) {
    if (used + passage.text.length > CONTEXT_BUDGET_CHARS) break;
    picked.push(passage);
    used += passage.text.length;
  }

  return { picked, complete: picked.length === passages.length };
}

/**
 * The text one question should be answered from.
 *
 * The document is read and embedded once, on the first question. After that a
 * question costs one embedding call for the question itself plus an in-memory
 * scan - `timings` reports each phase so a slow answer can be attributed
 * instead of guessed at.
 *
 * @returns {Promise<{blocks: Array, sources: Array, mode: string,
 *                    truncated: boolean, totalChars: number,
 *                    timings: object}|null>}
 *   null when the document holds no readable text.
 */
/**
 * The index a question needs: the document split into passages, plus whether
 * those passages are searchable yet.
 *
 * Embedding happens only when `embed` is set, which is the prewarm path. A
 * question never waits for it: an unembedded document is answered from its
 * opening section immediately, and becomes searchable once the background pass
 * has caught up.
 *
 * @returns {Promise<{aiIndex: object, model: string|null,
 *                    remaining: number}|null>} null when the document holds no
 *   readable text. `model` is the embedding model to search with, or null when
 *   the document is short enough to send whole or is not searchable yet.
 */
async function ensureIndex(document, timings, { embed = false, deadline } = {}) {
  const since = (start) => Date.now() - start;

  let aiIndex = document.aiIndex?.chunkCount ? document.aiIndex : null;

  // Passages written before the current format are derived data, so they are
  // thrown away and rebuilt rather than decoded wrongly.
  if (aiIndex && aiIndex.format !== INDEX_FORMAT) {
    logger.info(
      `Ask AI: rebuilding ${document._id} (index format ${
        aiIndex.format || 1
      } -> ${INDEX_FORMAT})`,
    );
    await invalidateDocumentIndex(document._id);
    aiIndex = null;
  }

  if (!aiIndex) {
    const start = Date.now();
    // Extraction is expensive, so two callers arriving together - the panel
    // warming while the user is already asking - must not both do it.
    aiIndex = await singleFlight(`build:${document._id}`, () =>
      buildIndex(document),
    );
    timings.indexMs = since(start);
    if (!aiIndex) return null;
  }

  // Short enough to send whole: nothing to search, nothing to embed.
  if (aiIndex.totalChars <= CONTEXT_BUDGET_CHARS) {
    return { aiIndex, model: null, remaining: 0 };
  }

  if (!geminiEmbeddingAI) {
    // Nothing is pending because nothing is possible: with no key these
    // passages will never be embedded, so no job is queued for them and the
    // panel says the document could not be indexed rather than "still going".
    return { aiIndex, model: null, remaining: 0 };
  }

  const embeddingModel = await getEmbeddingModel();
  // Vectors from a different model cannot be compared with this one's, so they
  // are dropped and rebuilt by the same resumable pass.
  const stale =
    aiIndex.embeddingModel && aiIndex.embeddingModel !== embeddingModel;

  if (stale && embed) {
    logger.info(
      `Ask AI: re-embedding ${document._id} (${aiIndex.embeddingModel} -> ${embeddingModel})`,
    );
    await DocumentChunk.updateMany(
      { documentId: document._id },
      { $unset: { embedding: "" } },
    );
    await Document.updateOne(
      { _id: document._id },
      { $unset: { "aiIndex.embeddingModel": "" } },
    );
    dropFromCache(document._id);
    aiIndex = { ...aiIndex, embeddingModel: undefined };
  }

  // 0 means every passage carries a vector from this model; null means we do
  // not know yet.
  let remaining = aiIndex.embeddingModel === embeddingModel ? 0 : null;

  if (embed && remaining === null) {
    const start = Date.now();

    const result = await singleFlight(`embed:${document._id}`, () =>
      embedPending(
        document,
        embeddingModel,
        deadline || Date.now() + EMBED_PASS_BUDGET_MS,
      ),
    );

    timings.indexMs += since(start);
    remaining = result.remaining;

    if (result.complete) {
      await Document.updateOne(
        { _id: document._id },
        { $set: { "aiIndex.embeddingModel": embeddingModel } },
      );
      aiIndex = { ...aiIndex, embeddingModel };
      // The cached copy has no vectors in it; the next load picks them up.
      dropFromCache(document._id);
    }
  }

  if (remaining === null) {
    // Not searchable yet, so how much is left - the panel says so, and the
    // queue worker reports progress with it.
    remaining = await DocumentChunk.countDocuments({
      documentId: document._id,
      embedding: { $exists: false },
    });
  }

  return {
    aiIndex,
    // Searchable only when every passage carries a vector from this model.
    model: aiIndex.embeddingModel === embeddingModel ? embeddingModel : null,
    remaining,
  };
}

/**
 * Does everything a question needs except answering it: splits the document if
 * this is its first time, and pulls its passages into memory.
 *
 * Called when the panel is opened, so the seconds of extraction and loading are
 * spent while the user is still reading rather than after they hit send.
 */
export async function prepareDocumentIndex(document) {
  const timings = { indexMs: 0, loadMs: 0 };

  // Splits the document and loads its text - seconds, not minutes. Embedding is
  // a queued job: a rate-limited tier cannot finish a long document inside any
  // request, and a worker can take the several minutes it needs without anyone
  // waiting on it.
  const ready = await ensureIndex(document, timings, { embed: false });

  if (!ready) return null;

  const start = Date.now();
  const { cache } = await loadPassages(document._id, ready.model);
  timings.loadMs = Date.now() - start;

  const fitsWhole = ready.aiIndex.totalChars <= CONTEXT_BUDGET_CHARS;

  return {
    mode: ready.model ? "retrieved" : fitsWhole ? "full" : "opening",
    chunkCount: ready.aiIndex.chunkCount,
    truncated: Boolean(ready.aiIndex.truncated),
    // Passages still waiting for a vector. Until this reaches zero, answers
    // come from the document's opening section.
    remaining: ready.remaining,
    cache,
    timings,
  };
}

export async function buildContext(document, { question, history = [] } = {}) {
  const timings = { indexMs: 0, embedMs: 0, loadMs: 0, selectMs: 0 };
  const since = (start) => Date.now() - start;

  const ready = await ensureIndex(document, timings);
  if (!ready) return null;

  const aiIndex = ready.aiIndex;

  if (ready.model) {
    try {
      // "Tell me more" carries no searchable content of its own, so a short
      // follow-up is embedded together with the question it follows.
      const previous = [...history]
        .reverse()
        .find((entry) => entry.role === "user")?.content;
      const query =
        question.length < 40 && previous
          ? `${previous}\n${question}`
          : question;

      const embedStart = Date.now();
      const { vector: queryVector, cached: queryCached } = await embedQuery(
        query,
        ready.model,
      );
      timings.embedMs = since(embedStart);
      timings.queryCache = queryCached ? "hit" : "miss";

      const loadStart = Date.now();
      const { passages, cache } = await loadPassages(document._id, ready.model);
      timings.loadMs = since(loadStart);
      timings.cache = cache;

      const selectStart = Date.now();
      const picked = selectChunks(passages, queryVector);
      timings.selectMs = since(selectStart);

      if (picked.length) {
        return {
          mode: "retrieved",
          blocks: picked,
          sources: picked.map(toSource),
          truncated: Boolean(aiIndex.truncated),
          totalChars: aiIndex.totalChars,
          timings,
        };
      }
    } catch (error) {
      // Embedding the question needs the same quota as everything else, and
      // when it is gone the opening section is a far better answer than an
      // error page.
      logger.warn(
        `Ask AI: retrieval unavailable for ${document._id} (${error.message}); answering from the opening section`,
      );
      timings.retrievalError = true;
    }
  }

  const loadStart = Date.now();
  // No model: the text is all that is needed, so the vectors are not fetched.
  const { passages, cache } = await loadPassages(document._id, null);
  timings.loadMs += since(loadStart);
  timings.cache = timings.cache ?? cache;

  const { picked, complete } = takeFromStart(passages);
  if (!picked.length) return null;

  return {
    mode: complete ? "full" : "opening",
    blocks: picked,
    // A document sent whole has nothing to cite - the answer used all of it.
    sources: complete ? [] : picked.map(toSource),
    truncated: Boolean(aiIndex.truncated) || !complete,
    totalChars: aiIndex.totalChars,
    timings,
  };
}

function toSource(chunk) {
  return {
    index: chunk.index,
    label: chunk.label || null,
    snippet:
      chunk.text.length > SNIPPET_CHARS
        ? `${chunk.text.slice(0, SNIPPET_CHARS).trim()}…`
        : chunk.text,
  };
}

/**
 * One embedding pass, for the queue worker.
 *
 * Bounded so the job stays observable and one document cannot monopolise the
 * worker: whatever is left is reported, and the job asks to be run again.
 *
 * @returns {Promise<{complete: boolean, remaining: number}>}
 */
export async function embedDocumentPassages(documentId) {
  const document = await Document.findById(documentId).select(
    "aiIndex s3Path fileType",
  );

  if (!document) return { complete: true, remaining: 0 };

  const timings = { indexMs: 0 };

  const ready = await ensureIndex(document, timings, {
    embed: true,
    deadline: Date.now() + EMBED_PASS_BUDGET_MS,
  });

  // No readable text: there is nothing to embed and never will be.
  if (!ready) return { complete: true, remaining: 0 };

  return { complete: ready.remaining === 0, remaining: ready.remaining };
}

/** Dropped on reprocess: the file behind these passages has been re-read. */
export async function invalidateDocumentIndex(documentId) {
  dropFromCache(documentId);
  await DocumentChunk.deleteMany({ documentId });
  await Document.updateOne({ _id: documentId }, { $unset: { aiIndex: "" } });
  await forgetUnreadable(documentId);
}
