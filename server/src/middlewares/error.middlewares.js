import config from "../config/config.js";
import logger from "../utils/logger.js";
import AppError from "../utils/appError.js";
import ApiResponse from "../utils/apiResponse.js";
import { ZodError } from "zod";

export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal server error";
  let errors = err.errors || [];

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    statusCode = 400;
    errors = err.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    message = !config.isProduction && errors.length
      ? `Validation failed: ${errors.map((e) => (e.field ? `${e.field} (${e.message})` : e.message)).join(", ")}`
      : "Validation failed";
  }

  // Handle Mongoose CastError (invalid ObjectId)
  else if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid ${err.path}`;
    errors = [{ field: err.path, message: `Invalid identifier format for ${err.path}` }];
  }

  // Handle Mongoose ValidationError
  else if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Database validation failed";
    errors = Object.values(err.errors).map((val) => ({
      field: val.path,
      message: val.message,
    }));
  }

  // Handle Mongoose Duplicate Key Error (code 11000)
  else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || "field";
    message = `Duplicate value for field '${field}'. Must be unique.`;
    errors = [{ field, message: `${field} must be unique` }];
  }

  // Handle JWT Errors
  else if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token. Please authenticate again.";
    errors = [{ field: "token", message: "Token is invalid" }];
  } else if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token has expired. Please refresh your session.";
    errors = [{ field: "token", message: "Token has expired" }];
  }

  // Handle JSON parse syntax error in body
  else if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    statusCode = 400;
    message = "Malformed JSON syntax in request body";
    errors = [{ field: "body", message: "Syntax error parsing JSON payload" }];
  }

  // Log error with context
  if (statusCode >= 500) {
    logger.error(
      {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
        errorCode: err.code,
        method: req.method,
        url: req.originalUrl?.split("?", 1)[0],
        ip: req.ip,
      },
      "Unhandled Server Error"
    );
  } else {
    logger.warn(
      {
        statusCode,
        errorName: err.name,
        errorCode: err.code,
        method: req.method,
        url: req.originalUrl?.split("?", 1)[0],
        ...(errors.length ? { validationErrors: errors } : {}),
      },
      "Handled Operational Error"
    );
  }

  // Do not expose internal errors or dependency/database details in production.
  if (config.isProduction && statusCode >= 500) {
    message = "An unexpected error occurred. Please try again later.";
    errors = [];
  }

  return ApiResponse.error(res, {
    statusCode,
    message,
    errors,
  });
};

export default errorHandler;
