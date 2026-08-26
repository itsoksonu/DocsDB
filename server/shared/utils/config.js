// Fail fast on missing configuration.
//
// Without this, a deployment missing (say) S3_BUCKET_NAME starts happily, serves
// traffic, and only fails when a user tries to upload - by which time the
// failure is a support ticket rather than a failed deploy.
import logger from "./logger.js";

const REQUIRED = [
  "MONGODB_URI",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "S3_BUCKET_NAME",
  "GOOGLE_CLIENT_ID",
  "FRONTEND_URL",
];

// Not required to boot, but each disables a feature. Worth a startup warning so
// it is obvious in the logs rather than surprising later.
const OPTIONAL = [
  ["REDIS_HOST", "rate limiting falls back to per-instance memory; no caching"],
  ["STRIPE_SECRET_KEY", "payouts and monetization are unavailable"],
  ["GEMINI_API_KEY", "Ask AI embeddings and semantic search are unavailable"],
  ["VIRUSTOTAL_API_KEY", "uploads fall back to basic file validation only"],
];

// Values shipped in the checked-in .env template. Seeing one in a real
// deployment means the variable was never actually filled in.
const PLACEHOLDER = /^(your_|changeme|xxx$|todo$)/i;

export function validateConfig() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  const placeholders = REQUIRED.filter(
    (key) => process.env[key] && PLACEHOLDER.test(process.env[key])
  );

  if (missing.length > 0 || placeholders.length > 0) {
    const problems = [
      ...missing.map((key) => `${key} is not set`),
      ...placeholders.map((key) => `${key} still holds a placeholder value`),
    ];
    throw new Error(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
  }

  for (const [key, consequence] of OPTIONAL) {
    if (!process.env[key] || PLACEHOLDER.test(process.env[key])) {
      logger.warn(`[config] ${key} is not configured - ${consequence}`);
    }
  }

  if (!process.env.NODE_ENV) {
    logger.warn(
      "[config] NODE_ENV is not set - defaulting to development behaviour"
    );
  }
}
