import { createRateLimiter } from "../../shared/utils/rateLimiter.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const int = (envVar, fallback) => parseInt(process.env[envVar], 10) || fallback;

// Per-route tiers. All are Redis-backed and keyed by user id when the request
// is authenticated (so users sharing an IP don't throttle each other), falling
// back to IP for unauthenticated routes. Values are generous defaults tuned for
// a large user base and overridable via env.
const rateLimitConfigs = {
  // Unauthenticated → keyed by IP. Kept moderate to slow credential stuffing,
  // but high enough not to lock out shared-IP users fat-fingering a password.
  auth: {
    name: "auth",
    windowMs: 15 * MIN,
    max: int("RL_AUTH_MAX", 100),
    message: "Too many authentication attempts, please try again in a few minutes.",
  },
  // Authenticated → keyed by user id.
  upload: {
    name: "upload",
    windowMs: HOUR,
    max: int("RL_UPLOAD_MAX", 300),
    message: "Upload limit reached, please try again later.",
  },
  search: {
    name: "search",
    windowMs: MIN,
    max: int("RL_SEARCH_MAX", 180), // ~3 req/sec sustained
    message: "You're searching too quickly, please slow down.",
  },
  write: {
    name: "write",
    windowMs: MIN,
    max: int("RL_WRITE_MAX", 120),
    message: "Too many requests, please slow down.",
  },
  download: {
    name: "download",
    windowMs: MIN,
    max: int("RL_DOWNLOAD_MAX", 60),
    message: "Download rate limit reached, please slow down.",
  },
  // Generic authenticated API fallback.
  api: {
    name: "api",
    windowMs: 15 * MIN,
    max: int("RL_API_MAX", 5000),
    message: "Too many requests, please try again later.",
  },
};

export const rateLimitMiddleware = (type = "api") => {
  const config = rateLimitConfigs[type] || rateLimitConfigs.api;
  return createRateLimiter(config);
};
