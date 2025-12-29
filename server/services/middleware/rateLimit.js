import rateLimit from "express-rate-limit";

const rateLimitConfigs = {
  auth: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // Increased from 5 to 10 to prevent lockouts from typos
    message: "Too many authentication attempts, please try again later.",
  },
  upload: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100,
    message: "Upload limit exceeded, please try again later.",
  },
  api: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 2000, // Increased from 1000 to 2000
    message: "Too many requests, please try again later.",
  },
  search: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 1 request per second average allowed for search
    message: "Search rate limit exceeded, please slow down.",
  },
};

export const rateLimitMiddleware = (type = "api") => {
  const config = rateLimitConfigs[type] || rateLimitConfigs.api;
  return rateLimit(config);
};
