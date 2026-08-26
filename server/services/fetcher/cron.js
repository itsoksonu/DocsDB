// Scheduled Document Fetcher.
// Entirely env-configurable; a no-op unless FETCHER_CRON_ENABLED=true.
//
//   FETCHER_CRON_ENABLED=true
//   FETCHER_CRON_SCHEDULE=0 3 * * *        # default: 3 AM daily
//   FETCHER_CRON_CATEGORIES=science,health,technology,fiction,education
//   FETCHER_CRON_COUNT_PER_CATEGORY=20     # default: 20
//   FETCHER_CONTACT_EMAIL=admin@mysite.com
import cron from "node-cron";
import { v4 as uuidv4 } from "uuid";
import {
  processDocumentQueue,
  FETCH_JOB_OPTIONS,
} from "../../shared/queues/processQueue.js";
import { resolveOwnerId } from "../../shared/utils/documentFetcher/fetcher.js";
import logger from "../../shared/utils/logger.js";

const DEFAULT_SCHEDULE = "0 3 * * *";
const DEFAULT_COUNT = 20;

// Rotation pointer (in-memory). Lets a long category list be spread across
// successive runs rather than enqueuing every category at once.
let rotationIndex = 0;

function getCategories() {
  return (process.env.FETCHER_CRON_CATEGORIES || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

async function runFetchCycle() {
  const categories = getCategories();
  if (categories.length === 0) {
    logger.warn("[fetcher:cron] no FETCHER_CRON_CATEGORIES configured — skipping run");
    return;
  }

  const count = parseInt(process.env.FETCHER_CRON_COUNT_PER_CATEGORY, 10) || DEFAULT_COUNT;

  // How many categories to process this run. If COUNT-style batching isn't
  // desired, this processes all of them; rotationIndex keeps order fair across
  // runs when the list is long.
  const perRun = categories.length;
  const owner = await resolveOwnerId();
  if (!owner) {
    logger.error(
      "[fetcher:cron] no system user available — set FETCHER_SYSTEM_USER_ID or create an admin user"
    );
    return;
  }

  const selected = [];
  for (let i = 0; i < perRun; i++) {
    selected.push(categories[(rotationIndex + i) % categories.length]);
  }
  rotationIndex = (rotationIndex + perRun) % categories.length;

  logger.info(
    `[fetcher:cron] enqueuing ${selected.length} categories (count=${count} each): ${selected.join(", ")}`
  );

  for (const category of selected) {
    const jobId = uuidv4();
    await processDocumentQueue.add(
      "fetch-documents",
      { category, count, requestedBy: owner },
      { ...FETCH_JOB_OPTIONS, jobId }
    );
    logger.info(`[fetcher:cron] queued job ${jobId} for category="${category}"`);
  }
}

/**
 * Initialise the scheduled fetcher. Safe to call unconditionally — it returns
 * immediately unless FETCHER_CRON_ENABLED is "true".
 */
export function initFetcherCron() {
  if (process.env.FETCHER_CRON_ENABLED !== "true") {
    logger.info("[fetcher:cron] disabled (set FETCHER_CRON_ENABLED=true to enable)");
    return null;
  }

  const schedule = process.env.FETCHER_CRON_SCHEDULE || DEFAULT_SCHEDULE;

  if (!cron.validate(schedule)) {
    logger.error(`[fetcher:cron] invalid FETCHER_CRON_SCHEDULE "${schedule}" — cron not started`);
    return null;
  }

  const task = cron.schedule(schedule, () => {
    runFetchCycle().catch((err) =>
      logger.error(`[fetcher:cron] run failed: ${err.message}`)
    );
  });

  logger.info(
    `[fetcher:cron] scheduled "${schedule}" for categories: ${
      getCategories().join(", ") || "(none configured)"
    }`
  );

  // Returned so shutdown can stop it. node-cron's timer otherwise keeps the
  // event loop alive, which only went unnoticed because shutdown calls
  // process.exit() explicitly.
  return task;
}

export default initFetcherCron;
