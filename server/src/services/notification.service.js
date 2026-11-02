import mongoose from "mongoose";
import Notification from "../models/notification.model.js";
import { getPaginationMetadata } from "../utils/pagination.js";
import AppError from "../utils/appError.js";
import logger from "../utils/logger.js";
class NotificationService {
  async create(input) {
    try {
      return await Notification.create(input);
    } catch (error) {
      if (error.code === 11000 && input.dedupeKey)
        return Notification.findOne({
          recipient: input.recipient,
          dedupeKey: input.dedupeKey,
        });
      throw error;
    }
  }
  async createSafely(input) {
    try {
      return await this.create(input);
    } catch (error) {
      logger.warn(
        {
          notificationType: input.type,
          relatedEntityType: input.relatedEntityType,
          errorName: error.name,
          errorCode: error.code,
        },
        "Best-effort notification creation failed",
      );
      return null;
    }
  }
  async list(user, { page = 1, limit = 20, type, unread } = {}) {
    const filter = {
      recipient: user._id,
      ...(type ? { type } : {}),
      ...(unread === "true"
        ? { readAt: null }
        : unread === "false"
          ? { readAt: { $ne: null } }
          : {}),
    };
    const [items, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments(filter),
    ]);
    return { items, meta: getPaginationMetadata(total, page, limit) };
  }
  async unreadCount(user) {
    return Notification.countDocuments({ recipient: user._id, readAt: null });
  }
  async markRead(id, user) {
    if (!mongoose.isValidObjectId(id))
      throw AppError.badRequest("Invalid notification ID");
    const item = await Notification.findOneAndUpdate(
      { _id: id, recipient: user._id },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!item) throw AppError.notFound("Notification not found");
    return item;
  }
  async markAllRead(user) {
    const result = await Notification.updateMany(
      { recipient: user._id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return { modifiedCount: result.modifiedCount };
  }
}
export const notificationService = new NotificationService();
export default notificationService;
