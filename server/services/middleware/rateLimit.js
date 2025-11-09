import rateLimit from 'express-rate-limit';

const rateLimitConfigs = {
  auth: {
    windowMs: 1 * 60 * 1000, // 15 minutes
    max: 50000, // 5 attempts per window
    message: 'Too many authentication attempts, please try again later.'
  },
  upload: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100, // 10 uploads per hour
    message: 'Upload limit exceeded, please try again later.'
  },
  api: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 100 requests per window
    message: 'Too many requests, please try again later.'
  },
  search: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 300, // 30 searches per minute
    message: 'Search rate limit exceeded, please slow down.'
  }
};

export const rateLimitMiddleware = (type = 'api') => {
  const config = rateLimitConfigs[type] || rateLimitConfigs.api;
  return rateLimit(config);
};