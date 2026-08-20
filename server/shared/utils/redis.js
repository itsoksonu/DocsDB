import databaseManager from "../database/connection.js";

/**
 * Route modules are imported before server.js connects to Redis, so anything
 * that captured `databaseManager.getRedisClient()` at module scope captured
 * null and kept it forever. Always go through this, never through a module
 * level constant.
 */
export function getRedis() {
  const client = databaseManager.getRedisClient();
  return client?.isReady ? client : null;
}
