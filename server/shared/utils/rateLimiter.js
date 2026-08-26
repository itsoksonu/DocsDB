// Centralized, horizontally-scalable rate limiting.
//
// Design goals (target: 100k+ users across multiple instances):
//   1. Shared counters via Redis (rate-limit-redis) so limits are consistent
//      across all server instances and memory stays bounded — the in-memory
//      default would track every IP separately on every instance.
//   2. User-friendly keying: authenticated requests are limited per user id,
//      NOT per IP, so many users behind one NAT/corporate proxy/mobile carrier
//      don't throttle each other. Unauthenticated requests fall back to IP.
//   3. Degrade, don't fail open: if Redis is briefly unavailable we fall back to
//      a process-local MemoryStore rather than 500'ing the API *or* allowing
//      everything. Limits become per-instance instead of global, which is a far
//      better outcome than an attacker removing all rate limiting by stressing
//      Redis.
import rateLimit, { MemoryStore } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import databaseManager from "../database/connection.js";
import logger from "./logger.js";

// Build the per-request key: prefer the authenticated user id, fall back to IP.
function userOrIpKey(req) {
  if (req.user?.userId) return `u:${req.user.userId}`;
  return `ip:${req.ip}`;
}

// 429 response in the app's standard JSON envelope.
function makeHandler(message) {
  return (req, res) => {
    res.status(429).json({ success: false, message });
  };
}

// A store wrapper that:
//   - lazily constructs the underlying RedisStore on first use (rate-limit-redis
//     issues a Redis command in its constructor, but limiters are built at
//     import time — before startServer() connects Redis), and
//   - degrades to a process-local MemoryStore on any Redis error, so a blip can
//     neither 500 the whole API nor silently disable rate limiting.
class ResilientRedisStore {
  constructor(prefix) {
    this.prefix = `rl:${prefix}:`;
    this.options = null;
    this.inner = null;
    this.fallback = null;
    this.windowMs = 60_000;
  }

  init(options) {
    this.options = options;
    this.windowMs = options.windowMs;
  }

  // Built lazily and reused, so counts survive across requests while Redis is
  // down. Bounded by MemoryStore's own window-based eviction.
  ensureFallback() {
    if (!this.fallback) {
      this.fallback = new MemoryStore();
      if (this.options) this.fallback.init(this.options);
    }
    return this.fallback;
  }

  // Build the real RedisStore once Redis is connected; cache it.
  ensureInner() {
    if (this.inner) return this.inner;
    const client = databaseManager.getRedisClient();
    // Redis not ready yet → caller degrades to the in-process store.
    if (!client || !client.isReady) return null;
    try {
      const store = new RedisStore({
        prefix: this.prefix,
        sendCommand: (...args) => client.sendCommand(args),
      });
      if (this.options) store.init(this.options);
      this.inner = store;
      return store;
    } catch (err) {
      logger.error(`[rate-limit] failed to init Redis store: ${err.message}`);
      return null;
    }
  }

  async increment(key) {
    const inner = this.ensureInner();
    if (!inner) return this.ensureFallback().increment(key);
    try {
      return await inner.increment(key);
    } catch (err) {
      logger.error(
        `[rate-limit] store error (degrading to in-process store): ${err.message}`
      );
      return this.ensureFallback().increment(key);
    }
  }

  async decrement(key) {
    const inner = this.ensureInner();
    if (!inner) return this.ensureFallback().decrement(key);
    try {
      await inner.decrement(key);
    } catch (err) {
      logger.error(`[rate-limit] decrement error: ${err.message}`);
    }
  }

  async resetKey(key) {
    const inner = this.ensureInner();
    if (!inner) return this.ensureFallback().resetKey(key);
    try {
      await inner.resetKey(key);
    } catch (err) {
      logger.error(`[rate-limit] resetKey error: ${err.message}`);
    }
  }
}

// Build a store. Uses Redis (shared across instances) when configured, else the
// in-memory default (dev / single instance).
function buildStore(prefix) {
  if (!process.env.REDIS_HOST) {
    logger.warn(
      `[rate-limit] REDIS_HOST not set — using in-memory store for "${prefix}" (NOT safe for multi-instance)`
    );
    return undefined; // express-rate-limit defaults to MemoryStore
  }
  return new ResilientRedisStore(prefix);
}

/**
 * Create an express-rate-limit middleware with shared-store + user-aware keys.
 * @param {object} opts
 * @param {string} opts.name       unique prefix for the Redis key namespace
 * @param {number} opts.windowMs   window length in ms
 * @param {number} opts.max        max requests per key per window
 * @param {string} opts.message    429 message
 * @param {Function} [opts.keyGenerator] override key strategy (defaults to user-or-IP)
 */
export function createRateLimiter({ name, windowMs, max, message, keyGenerator, skipPaths = [] }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyGenerator || userOrIpKey,
    handler: makeHandler(message),
    // Don't spend quota on CORS preflight or explicitly skipped paths (e.g. health checks).
    skip: (req) => req.method === "OPTIONS" || skipPaths.includes(req.path),
    store: buildStore(name),
    // We supply a custom keyGenerator (user-or-IP); disable the built-in IP
    // validation that assumes the default IP-based key generator.
    validate: { ip: false },
  });
}

export { userOrIpKey };
