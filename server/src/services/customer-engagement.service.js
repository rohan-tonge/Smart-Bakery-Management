import mongoose from "mongoose";
import Feedback from "../models/feedback.model.js";
import Complaint from "../models/complaint.model.js";
import Order from "../models/order.model.js";
import { notificationService } from "./notification.service.js";
import { USER_ROLES, COMPLAINT_STATUSES } from "../utils/constants.js";
import AppError from "../utils/appError.js";
import { getPaginationMetadata } from "../utils/pagination.js";
const admin = (u) =>
  Boolean(
    u &&
      [
        USER_ROLES.OWNER_MANAGER,
        USER_ROLES.OWNER,
        USER_ROLES.MANAGER,
        "OWNER",
        "MANAGER",
      ].includes(u.role),
  );
const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) throw AppError.badRequest("Invalid ID");
};
const presentComplaint = (complaint, user) => {
  if (admin(user)) return complaint;
  const value = complaint.toObject ? complaint.toObject() : { ...complaint };
  delete value.internalNotes;
  delete value.resolvedBy;
  return value;
};
class CustomerEngagementService {
  async createFeedback(input, user) {
    const order = await Order.findOne({ _id: input.order, customer: user._id });
    if (!order) throw AppError.notFound("Eligible order not found");
    if (!["DELIVERED", "COMPLETED"].includes(order.status))
      throw AppError.conflict(
        "Feedback can only be submitted for delivered orders",
      );
    const line = order.items.find(
      (i) =>
        String(i.productId) === input.product &&
        String(i.variantId) === input.variant,
    );
    if (!line)
      throw AppError.badRequest("Product variant is not part of this order");
    try {
      return await Feedback.create({
        customer: user._id,
        order: order._id,
        product: line.productId,
        variant: line.variantId,
        productNameSnapshot: line.productName,
        variantNameSnapshot: line.variantName,
        rating: input.rating,
        comment: input.comment,
        criteria: input.criteria || {},
        tags: input.tags || [],
        photoReference: input.photoReference || "",
      });
    } catch (e) {
      if (e.code === 11000)
        throw AppError.conflict("Feedback already exists for this order item");
      throw e;
    }
  }
  async listFeedback(query, user) {
    const filter = {
      ...(admin(user) ? {} : { customer: user._id }),
      ...(query.status && admin(user) ? { status: query.status } : {}),
      ...(query.rating ? { rating: Number(query.rating) } : {}),
      ...(query.product ? { product: query.product } : {}),
    };
    const [items, total] = await Promise.all([
      Feedback.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      Feedback.countDocuments(filter),
    ]);
    return {
      items,
      meta: getPaginationMetadata(total, query.page, query.limit),
    };
  }
  async getFeedback(id, user) {
    checkId(id);
    const f = await Feedback.findOne({
      _id: id,
      ...(admin(user) ? {} : { customer: user._id }),
    });
    if (!f) throw AppError.notFound("Feedback not found");
    return f;
  }
  async updateFeedback(id, input, user) {
    const f = await this.getFeedback(id, user);
    if (!admin(user) && f.status !== "APPROVED")
      throw AppError.conflict("Feedback can no longer be edited");
    Object.assign(f, input);
    return f.save();
  }
  async ratingSummary(productId) {
    checkId(productId);
    const rows = await Feedback.aggregate([
      {
        $match: {
          product: new mongoose.Types.ObjectId(productId),
          status: "APPROVED",
        },
      },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let count = 0,
      sum = 0;
    for (const r of rows) {
      distribution[r._id] = r.count;
      count += r.count;
      sum += r._id * r.count;
    }
    return {
      averageRating: count ? Number((sum / count).toFixed(2)) : null,
      totalRatings: count,
      distribution,
    };
  }
  async createComplaint(input, user) {
    const order = await Order.findOne({ _id: input.order, customer: user._id });
    if (!order) throw AppError.notFound("Order not found");
    let line;
    if (input.product) {
      line = order.items.find(
        (i) =>
          String(i.productId) === input.product &&
          String(i.variantId) === input.variant,
      );
      if (!line)
        throw AppError.badRequest("Product variant is not part of this order");
    }
    return presentComplaint(
      await Complaint.create({
        customer: user._id,
        order: order._id,
        product: line?.productId || null,
        variant: line?.variantId || null,
        category: input.category,
        description: input.description,
      }),
      user,
    );
  }
  async listComplaints(query, user) {
    const filter = {
      ...(admin(user) ? {} : { customer: user._id }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority && admin(user) ? { priority: query.priority } : {}),
    };
    const find = Complaint.find(filter);
    if (!admin(user)) find.select("-internalNotes -resolvedBy");
    const [items, total] = await Promise.all([
      find
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      Complaint.countDocuments(filter),
    ]);
    return {
      items: items.map((x) => presentComplaint(x, user)),
      meta: getPaginationMetadata(total, query.page, query.limit),
    };
  }
  async getComplaint(id, user) {
    checkId(id);
    const query = Complaint.findOne({
      _id: id,
      ...(admin(user) ? {} : { customer: user._id }),
    });
    if (!admin(user)) query.select("-internalNotes -resolvedBy");
    const c = await query;
    if (!c) throw AppError.notFound("Complaint not found");
    return c;
  }
  async updateComplaint(id, input, user) {
    const c = await this.getComplaint(id, user);
    const priorStatus = c.status;
    let statusChanged = false;
    if (!admin(user)) {
      if (c.status !== COMPLAINT_STATUSES.OPEN)
        throw AppError.conflict("Only open complaints can be updated");
      c.description = input.description;
    } else {
      if (input.status) {
        const allowed = {
          OPEN: ["IN_REVIEW"],
          IN_REVIEW: ["RESOLVED", "CLOSED"],
          RESOLVED: ["CLOSED", "IN_REVIEW"],
          CLOSED: [],
        };
        if (
          input.status !== c.status &&
          !allowed[c.status].includes(input.status)
        )
          throw AppError.conflict(
            `Cannot transition complaint from ${c.status} to ${input.status}`,
          );
        statusChanged = input.status !== c.status;
        c.status = input.status;
        if (input.status === "RESOLVED") {
          c.resolvedAt = new Date();
          c.resolvedBy = user._id;
        } else if (input.status === "IN_REVIEW") {
          c.resolvedAt = null;
          c.resolvedBy = null;
        }
      }
      if (input.priority) c.priority = input.priority;
      if (input.resolution !== undefined) c.resolution = input.resolution;
      if (input.internalNotes !== undefined)
        c.internalNotes = input.internalNotes;
    }
    const saved = statusChanged
      ? await Complaint.findOneAndUpdate(
          { _id: c._id, status: priorStatus, updatedAt: c.updatedAt },
          {
            $set: {
              status: c.status,
              priority: c.priority,
              resolution: c.resolution,
              internalNotes: c.internalNotes,
              resolvedAt: c.resolvedAt,
              resolvedBy: c.resolvedBy,
            },
          },
          { new: true, runValidators: true },
        )
      : await c.save();
    if (!saved)
      throw AppError.conflict(
        "Complaint changed while it was being updated; reload and retry",
      );
    if (admin(user) && statusChanged)
      await notificationService.createSafely({
        recipient: c.customer,
        type: "COMPLAINT_UPDATED",
        title: "Complaint updated",
        message: `Your complaint status is ${saved.status.toLowerCase().replace("_", " ")}.`,
        relatedEntityType: "COMPLAINT",
        relatedEntityId: c._id,
        dedupeKey: `complaint:${c._id}:${priorStatus}:${saved.status}:${saved.updatedAt.getTime()}`,
      });
    return presentComplaint(saved, user);
  }
}
export const customerEngagementService = new CustomerEngagementService();
export default customerEngagementService;
