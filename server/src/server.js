import app from "./app.js";
import config from "./config/config.js";
import { connectToDb, disconnectDb } from "./config/db.js";
import logger from "./utils/logger.js";
import cleanupService from "./services/cleanup.service.js";

let server;
let shuttingDown = false;

const startServer = async () => {
  try {
    logger.info("Initializing Smart Bakery Management System backend...");
    logger.info(`Environment: ${config.NODE_ENV}`);

    // Step 1: Connect to MongoDB
    logger.info("Connecting to MongoDB...");
    await connectToDb();

    // Step 2: Start HTTP Server only after successful DB connection
    server = app.listen(config.PORT, () => {
      logger.info(
        `🚀 Server is running on port ${config.PORT} (http://localhost:${config.PORT})`,
      );
      logger.info(
        `Health check available at: http://localhost:${config.PORT}/api/v1/health`,
      );
      // Start 30-day payment screenshot retention cleanup timer
      cleanupService.startScheduledRetentionJob();
    });
  } catch (error) {
    logger.fatal(
      { errorName: error.name, errorCode: error.code },
      "Server startup failed. Terminating process...",
    );
    process.exit(1);
  }
};

// Graceful Shutdown Handler
const gracefulShutdown = async (signal, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  cleanupService.stopScheduledRetentionJob();
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  if (server) {
    const timeout = setTimeout(() => {
      logger.error("Forcefully shutting down due to timeout");
      server.closeAllConnections?.();
      process.exit(1);
    }, 10000);
    timeout.unref();
    server.close(async (error) => {
      clearTimeout(timeout);
      if (error) {
        logger.error(
          { errorName: error.name, errorCode: error.code },
          "HTTP server close failed",
        );
        exitCode = 1;
      }
      logger.info("HTTP server closed.");
      await disconnectDb();
      logger.info("Graceful shutdown completed. Exiting process.");
      process.exit(exitCode);
    });
  } else {
    await disconnectDb();
    process.exit(exitCode);
  }
};

// Listen for termination signals
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.fatal(
    { errorName: reason?.name, errorCode: reason?.code },
    "Unhandled Rejection at Promise",
  );
  gracefulShutdown("unhandledRejection", 1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.fatal(
    { errorName: error.name, errorCode: error.code },
    "Uncaught Exception thrown",
  );
  gracefulShutdown("uncaughtException", 1);
});

// Kick off server startup
startServer();

