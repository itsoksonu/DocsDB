import logger from '../utils/logger.js';

// Opt IN to verbose errors rather than opting out of them. Gating on
// `NODE_ENV !== 'production'` means a deployment where the variable is unset or
// misspelled silently returns raw messages and full stack traces to clients.
const exposeInternals = process.env.DEBUG_ERRORS === 'true';

export const errorHandler = (error, req, res, next) => {
  logger.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    // req.path, not originalUrl: the query string can carry tokens and emails,
    // and these logs are retained on disk.
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Mongoose validation error
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message
    }));

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  // Mongoose duplicate key error
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    return res.status(409).json({
      success: false,
      message: `${field} already exists`
    });
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Default error
  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: exposeInternals ? error.message : 'Something went wrong',
    ...(exposeInternals && { stack: error.stack })
  });
};