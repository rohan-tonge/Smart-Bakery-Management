import PaymentProof from "../models/paymentProof.model.js";
import Order from "../models/order.model.js";
import logger from "../utils/logger.js";
import fs from "node:fs/promises";
import path from "node:path";

class CleanupService {
  constructor() {
    this.intervalId = null;
  }

  /**
   * Cleans up payment screenshots older than retentionDays (default 30 days)
   * Nullifies binary image data, unlinks any disk files, and marks proof record as deleted
   * while strictly preserving order/payment records, verification status, timestamps, and audit history.
   */
  async cleanupExpiredScreenshots({ retentionDays = 30 } = {}) {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const now = new Date();

    try {
      // Find all proofs that have passed their 30-day expiration or cutoff date and are not yet marked deleted
      const expiredProofs = await PaymentProof.find({
        isDeleted: false,
        $or: [
          { expiresAt: { $lte: now } },
          { uploadedAt: { $lte: cutoffDate } },
        ],
      });

      if (!expiredProofs.length) {
        return { cleanedCount: 0, timestamp: now };
      }

      let cleanedCount = 0;

      for (const proof of expiredProofs) {
        // 1. Remove binary data from MongoDB to free storage
        proof.data = null;
        proof.isDeleted = true;
        proof.deletedAt = now;
        proof.deletedReason = "AUTOMATIC_30_DAY_RETENTION_CLEANUP";
        await proof.save();

        // 2. Remove any optional local disk file if present
        if (proof.fileName) {
          const possibleDiskPaths = [
            path.resolve("uploads/payment-proofs", proof.fileName),
            path.resolve("server/uploads/payment-proofs", proof.fileName),
          ];
          for (const diskPath of possibleDiskPaths) {
            try {
              await fs.unlink(diskPath);
            } catch {
              // File might only exist in MongoDB buffer or already unlinked
            }
          }
        }

        // 3. Update the Order paymentProof metadata without modifying the order status, payment status, or timestamps
        await Order.updateOne(
          { _id: proof.order },
          {
            $set: {
              "paymentProof.isDeleted": true,
              "paymentProof.deletedAt": now,
            },
          }
        );

        cleanedCount++;
      }

      logger.info({ cleanedCount }, "Completed 30-day payment screenshot retention cleanup");
      return { cleanedCount, timestamp: now };
    } catch (error) {
      logger.error({ error }, "Error during payment screenshot retention cleanup");
      return { cleanedCount: 0, error: error.message, timestamp: now };
    }
  }

  async purgeExpiredPaymentProofs(options = {}) {
    return this.cleanupExpiredScreenshots(options);
  }

  /**
   * Start recurring background retention cleanup task
   * @param {number} intervalMs - Frequency of checks (default: every 6 hours)
   */
  startScheduledRetentionJob(intervalMs = 6 * 60 * 60 * 1000) {
    if (this.intervalId) return;

    // Run initial cleanup on startup after a 5-second grace period
    setTimeout(() => {
      this.cleanupExpiredScreenshots().catch((err) =>
        logger.error({ err }, "Initial retention cleanup failed")
      );
    }, 5000);

    // Schedule periodic execution
    this.intervalId = setInterval(() => {
      this.cleanupExpiredScreenshots().catch((err) =>
        logger.error({ err }, "Periodic retention cleanup failed")
      );
    }, intervalMs);

    if (this.intervalId.unref) {
      this.intervalId.unref();
    }

    logger.info("Scheduled 30-day payment screenshot retention cleanup timer initialized");
  }

  stopScheduledRetentionJob() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const cleanupService = new CleanupService();
export default cleanupService;
