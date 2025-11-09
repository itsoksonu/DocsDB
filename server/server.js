import express, { json, urlencoded } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';

// Import middleware and routes
import { errorHandler } from './shared/middleware/errorHandler.js';
import { requestLogger } from './shared/middleware/logger.js';
import { securityHeaders } from './shared/middleware/security.js';
import authRoutes from './services/auth/routes.js';
import uploadRoutes from './services/upload/routes.js';
import documentRoutes from './services/document/routes.js';
import feedRoutes from './services/feed/routes.js';
import monetizationRoutes from './services/monetization/routes.js';
import downloadRoutes from './services/download/routes.js';
import adminRoutes from './services/admin/routes.js';
import oauthRoutes from './services/OAuth/routes.js';

// Database connection - import the default export
import databaseManager from './shared/database/connection.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing middleware
app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Request logging
app.use(requestLogger);

// Security headers
app.use(securityHeaders);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// API Routes
app.use(`/api/${process.env.API_VERSION || 'v1'}/auth`, authRoutes);
app.use(`/api/${process.env.API_VERSION || 'v1'}/oauth`, oauthRoutes);
app.use(`/api/${process.env.API_VERSION || 'v1'}/upload`, uploadRoutes);
app.use(`/api/${process.env.API_VERSION || 'v1'}/documents`, documentRoutes);
app.use(`/api/${process.env.API_VERSION || 'v1'}/feed`, feedRoutes);
app.use(`/api/${process.env.API_VERSION || 'v1'}/monetization`, monetizationRoutes);
app.use(`/api/${process.env.API_VERSION || 'v1'}/download`, downloadRoutes);
app.use(`/api/${process.env.API_VERSION || 'v1'}/admin`, adminRoutes);

// Error handling (must be last)
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    data: null
  });
});

// Start server
async function startServer() {
  try {
    // Connect to databases using the database manager
    await databaseManager.connectMongo();
    await databaseManager.connectRedis();

    app.listen(PORT, () => {
      console.log(`🚀 DocsDB Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(`📚 API Base: http://localhost:${PORT}/api/${process.env.API_VERSION || 'v1'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;