import mongoose from "mongoose";
import config from "./config.js";
import logger from "../utils/logger.js";

// Monitor Mongoose connection events
mongoose.connection.on("connected", () => {
  logger.info(`MongoDB connected successfully to database: ${mongoose.connection.name}`);
});

mongoose.connection.on("error", (err) => {
  logger.error({ errorName: err.name, errorCode: err.code }, "MongoDB runtime connection error");
});

mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected");
});

export const connectToDb = async () => {
  try {
    const conn = await mongoose.connect(config.db.uri, {
      dbName: config.db.dbName,
    });
    return conn;
  } catch (error) {
    logger.fatal({ errorName: error.name, errorCode: error.code }, "Failed to connect to MongoDB. Application exiting...");
    throw error;
  }
};

export const disconnectDb = async () => {
  try {
    await mongoose.connection.close(false);
    logger.info("MongoDB connection closed gracefully");
  } catch (error) {
    logger.error({ errorName: error.name, errorCode: error.code }, "Error while disconnecting MongoDB");
  }
};

export default connectToDb;
