import rateLimit from "express-rate-limit";
import ApiResponse from "../utils/apiResponse.js";
import config from "../config/config.js";

// Relaxed rate limits are strictly isolated to development mode.
// In production, test, or any other environment, strict production limits apply.
const isDevEnvironment =
  config.NODE_ENV === "development" &&
  config.isDevelopment === true &&
  !config.isProduction;

export const GLOBAL_RATE_LIMIT = isDevEnvironment ? 3000 : 300;
export const AUTH_RATE_LIMIT = isDevEnvironment ? 200 : 20;

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: GLOBAL_RATE_LIMIT,
  // In automated test mode, skip unless explicitly enabled via x-test-rate-limit for security verification
  skip: (req) => config.isTest && req.headers["x-test-rate-limit"] !== "true",
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  validate: { xForwardedForHeader: false },
  handler: (req, res) => {
    return ApiResponse.error(res, {
      statusCode: 429,
      message: "Too many requests from this IP. Please try again after 15 minutes.",
      errors: [
        {
          field: "rateLimit",
          message: "Request limit exceeded",
        },
      ],
    });
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: AUTH_RATE_LIMIT,
  // In automated test mode, skip unless explicitly enabled via x-test-rate-limit for security verification
  skip: (req) => config.isTest && req.headers["x-test-rate-limit"] !== "true",
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => {
    return ApiResponse.error(res, {
      statusCode: 429,
      message: "Too many authentication attempts. Please try again after 15 minutes.",
      errors: [
        {
          field: "authLimit",
          message: "Authentication attempt limit exceeded",
        },
      ],
    });
  },
});

export default globalRateLimiter;
