import { Router } from "express";
import mongoose from "mongoose";
import ApiResponse from "../utils/apiResponse.js";
import config from "../config/config.js";

const router = Router();

router.get("/", (req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;

  return ApiResponse.success(res, {
    statusCode: 200,
    message: "Smart Bakery API is running",
    data: {
      status: "healthy",
      database: isDbConnected ? "connected" : "disconnected",
      environment: config.NODE_ENV,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

router.get("/ready", (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  return ApiResponse.success(res, {
    statusCode: ready ? 200 : 503,
    message: ready ? "Application is ready" : "Application is not ready",
    data: {
      status: ready ? "ready" : "not_ready",
      database: ready ? "connected" : "disconnected",
    },
  });
});

export default router;
