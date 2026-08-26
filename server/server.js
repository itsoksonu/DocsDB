import express, { json, urlencoded } from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import "dotenv/config";

import { errorHandler } from "./shared/middleware/errorHandler.js";
import { requestLogger } from "./shared/middleware/logger.js";
import { securityHeaders } from "./shared/middleware/security.js";
import { createRateLimiter } from "./shared/utils/rateLimiter.js";
import { validateConfig } from "./shared/utils/config.js";
import logger from "./shared/utils/logger.js";

import authRoutes from "./services/auth/routes.js";
import uploadRoutes from "./services/upload/routes.js";
import documentRoutes from "./services/document/routes.js";
import feedRoutes from "./services/feed/routes.js";
import monetizationRoutes from "./services/monetization/routes.js";
import downloadRoutes from "./services/download/routes.js";
import adminRoutes from "./services/admin/routes.js";
import oauthRoutes from "./services/OAuth/routes.js";
import reportRoutes from "./services/report/routes.js";
import fetcherRoutes from "./services/fetcher/routes.js";
import { initFetcherCron } from "./services/fetcher/cron.js";

import databaseManager from "./shared/database/connection.js";

const app = express();
const PORT = process.env.PORT || 3001;
const SHUTDOWN_TIMEOUT_MS =
  parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 25_000;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
        scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Allowed browser origins. Built from FRONTEND_URL + a comma-separated
// ALLOWED_ORIGINS env list + sensible production/dev defaults. Anything not in
// the set is rejected (no Access-Control-Allow-Origin header is sent).
const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((o) => o.trim()),
    "https://docsdb.in",
    "https://www.docsdb.in",
    "http://localhost:3000",
  ].filter(Boolean)
);

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (curl, server-to-server, health checks) that
      // send no Origin header.
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      logger.warn(`Blocked CORS request from origin: ${origin}`);
      // Reject without throwing: cors omits the ACAO header and the browser
      // blocks it, but we don't surface a 500.
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Set-Cookie"],
  })
);

app.use(cookieParser());

app.set("trust proxy", 1);

// Global safety-net limiter. Runs before auth, so it is keyed by IP. Kept
// generous (per-route tiers do the fine-grained, per-user limiting) and skips
// health checks. Shared across instances via Redis — see shared/utils/rateLimiter.js.
const limiter = createRateLimiter({
  name: "global",
  windowMs: parseInt(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
  max: parseInt(process.env.GLOBAL_RATE_LIMIT_MAX) || 1000,
  message: "Too many requests from this IP, please slow down.",
  skipPaths: ["/health", "/ready"],
});
app.use(limiter);

app.use(json({ limit: "10mb" }));
app.use(urlencoded({ extended: true, limit: "10mb" }));

app.use(compression());

app.use(requestLogger);

app.use(securityHeaders);

// Liveness: is the process up? Deliberately dependency-free so a Redis blip
// does not get the container restarted. NODE_ENV is not reported - an unauthed
// endpoint should not describe the deployment.
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Readiness: should this instance receive traffic? Reports 503 while Mongo is
// down so a load balancer can route around it.
app.get("/ready", (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  const redisReady = Boolean(databaseManager.getRedisClient()?.isReady);

  res.status(mongoReady ? 200 : 503).json({
    status: mongoReady ? "READY" : "NOT_READY",
    checks: { mongo: mongoReady, redis: redisReady },
  });
});

// API Routes
app.use(`/api/${process.env.API_VERSION || "v1"}/auth`, authRoutes);
app.use(`/api/${process.env.API_VERSION || "v1"}/oauth`, oauthRoutes);
app.use(`/api/${process.env.API_VERSION || "v1"}/upload`, uploadRoutes);
app.use(`/api/${process.env.API_VERSION || "v1"}/documents`, documentRoutes);
app.use(`/api/${process.env.API_VERSION || "v1"}/feed`, feedRoutes);
app.use(
  `/api/${process.env.API_VERSION || "v1"}/monetization`,
  monetizationRoutes
);
app.use(`/api/${process.env.API_VERSION || "v1"}/download`, downloadRoutes);
app.use(`/api/${process.env.API_VERSION || "v1"}/report`, reportRoutes);
app.use(`/api/${process.env.API_VERSION || "v1"}/admin`, adminRoutes);
app.use(`/api/${process.env.API_VERSION || "v1"}/admin`, fetcherRoutes);

// 404 first, then the error handler. Express skips 4-arg error middleware in the
// normal flow so the previous order happened to work, but an error thrown from
// the catch-all would have escaped it.
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    data: null,
  });
});

app.use(errorHandler);

async function startServer() {
  try {
    // Before anything opens a connection or binds a port.
    validateConfig();

    await databaseManager.connectMongo();
    await databaseManager.connectRedis();

    // Start the scheduled document fetcher (no-op unless enabled via env).
    const fetcherTask = initFetcherCron();

    const server = app.listen(PORT, () => {
      console.log(`🚀 DocsDB Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(
        `📚 API Base: http://localhost:${PORT}/api/${
          process.env.API_VERSION || "v1"
        }`
      );
    });

    // Initialize Socket.io
    const { initSocket, closeSocket } = await import(
      "./shared/utils/socket.js"
    );
    initSocket(server, {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    });

    // View and download counts are buffered in Redis; drain the buffer before
    // the process goes away so a deploy does not throw away the last window.
    const { stopCounters } = await import("./shared/utils/counters.js");
    const { processDocumentQueue } = await import(
      "./shared/queues/processQueue.js"
    );

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`Received ${signal}, draining and shutting down`);

      // Hard deadline: if anything below hangs, still exit rather than letting
      // the orchestrator SIGKILL us mid-flush.
      const forceExit = setTimeout(() => {
        logger.error("Shutdown timed out, forcing exit");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExit.unref();

      try {
        fetcherTask?.stop();
        // Stop accepting new connections and wait for in-flight requests. The
        // previous code called server.close() without awaiting it and then
        // exited immediately, cutting live responses off.
        await closeSocket();
        await new Promise((resolve) => server.close(resolve));
        await processDocumentQueue.close();
        await stopCounters();
        await databaseManager.disconnect();
      } catch (error) {
        logger.error("Error during shutdown:", error);
      }

      clearTimeout(forceExit);
      process.exit(0);
    };

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));

    // Without these, an escaped rejection or throw kills the process with the
    // Redis counter buffer still undrained.
    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled promise rejection:", reason);
    });
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught exception:", error);
      shutdown("uncaughtException");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

export default app;
