import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import config from "./config/config.js";
import logger from "./utils/logger.js";
import globalRateLimiter from "./middlewares/rateLimit.middlewares.js";
import notFoundMiddleware from "./middlewares/notFound.middlewares.js";
import errorHandler from "./middlewares/error.middlewares.js";
import healthRoutes from "./routes/health.routes.js";
import apiV1Router from "./routes/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, "../../client/dist");

const app = express();

// Trust proxy for rate limiting if behind reverse proxy
app.set("trust proxy", config.trustProxyHops);

// Security Headers via Helmet
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      const allowedOrigins = config.isProduction
        ? config.cors.origins
        : [
            ...config.cors.origins,
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:3000",
          ];

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Idempotency-Key",
      "x-guest-id",
      "X-Guest-Id",
    ],
    exposedHeaders: [
      "Content-Disposition",
      "Content-Type",
      "Content-Length",
      "X-Payment-Proof-File-Name",
      "X-Payment-Proof-Mime-Type",
      "X-Payment-Proof-Size",
      "X-Payment-Proof-Uploaded-At",
    ],
  }),
);

// HTTP Request Logging
app.use(
  pinoHttp({
    logger,
    // Keep credentials out of request logs, including response Set-Cookie headers.
    // pino-http's default serializers include request and response headers.
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url?.split("?", 1)[0],
        remoteAddress: req.remoteAddress,
      }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    autoLogging: {
      ignore: (req) => req.url === "/api/v1/health", // Keep health checks out of noisy logs
    },
    customLogLevel: (res, err) => {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  }),
);

// Rate Limiting
app.use(globalRateLimiter);

// Body Parsing Middlewares
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buffer) => {
      if (req.originalUrl?.split("?", 1)[0] === "/api/v1/payments/webhook")
        req.rawBody = Buffer.from(buffer);
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser(config.jwt.cookieSecret));

// Root Health Route alias
app.use("/health", healthRoutes);

// API Version 1 Mounting
app.use("/api/v1", apiV1Router);

// Serve client PWA assets and handle SPA routing in production
if (config.isProduction && fs.existsSync(clientDistPath)) {
  app.use(
    express.static(clientDistPath, {
      setHeaders: (res, filePath) => {
        if (
          filePath.endsWith("sw.js") ||
          filePath.endsWith("index.html") ||
          filePath.endsWith("manifest.webmanifest")
        ) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

// 404 Not Found Handler
app.use(notFoundMiddleware);

// Centralized Error Handling Middleware
app.use(errorHandler);

export default app;
