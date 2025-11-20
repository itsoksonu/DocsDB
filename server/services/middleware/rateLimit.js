import rateLimit from 'express-rate-limit';

const rateLimitConfigs = {
  auth: {
    windowMs: 1 * 60 * 1000,
    max: 5,
    message: 'Too many authentication attempts, please try again later.'
  },
  upload: {
    windowMs: 60 * 60 * 1000,
    max: 100,
    message: 'Upload limit exceeded, please try again later.'
  },
  api: {
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many requests, please try again later.'
  },
  search: {
    windowMs: 1 * 60 * 1000,
    max: 300,
    message: 'Search rate limit exceeded, please slow down.'
  }
};

export const rateLimitMiddleware = (type = 'api') => {
  const config = rateLimitConfigs[type] || rateLimitConfigs.api;
  return rateLimit(config);
};