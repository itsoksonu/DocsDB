import express, { json, urlencoded } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import "dotenv/config";

import { errorHandler } from "./shared/middleware/errorHandler.js";
import { requestLogger } from "./shared/middleware/logger.js";
import { securityHeaders } from "./shared/middleware/security.js";
import { createRateLimiter } from "./shared/utils/rateLimiter.js";

import authRoutes from "./services/auth/routes.js";
import uploadRoutes from "./services/upload/routes.js";
import documentRoutes from "./services/document/routes.js";
import feedRoutes from "./services/feed/routes.js";
import monetizationRoutes from "./services/monetization/routes.js";
import downloadRoutes from "./services/download/routes.js";
import adminRoutes from "./services/admin/routes.js";
import oauthRoutes from "./services/OAuth/routes.js";
import reportRoutes from "./services/report/routes.js";

import databaseManager from "./shared/database/connection.js";

const app = express();
const PORT = process.env.PORT || 3001;

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

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
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
  skipPaths: ["/health"],
});
app.use(limiter);

app.use(json({ limit: "10mb" }));
app.use(urlencoded({ extended: true, limit: "10mb" }));

app.use(compression());

app.use(requestLogger);

app.use(securityHeaders);

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
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

app.use(errorHandler);

app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    data: null,
  });
});

async function startServer() {
  try {
    await databaseManager.connectMongo();
    await databaseManager.connectRedis();

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
    const { initSocket } = await import("./shared/utils/socket.js");
    initSocket(server, {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

export default app;
