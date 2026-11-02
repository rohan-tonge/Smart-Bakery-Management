import mongoose from "mongoose";
import { COMPLAINT_PRIORITIES, COMPLAINT_STATUSES } from "../utils/constants.js";
const schema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null }, variant: { type: mongoose.Schema.Types.ObjectId, default: null },
  category: { type: String, trim: true, maxlength: 80, required: true }, description: { type: String, trim: true, maxlength: 2000, required: true },
  status: { type: String, enum: Object.values(COMPLAINT_STATUSES), default: COMPLAINT_STATUSES.OPEN, index: true },
  priority: { type: String, enum: Object.values(COMPLAINT_PRIORITIES), default: COMPLAINT_PRIORITIES.MEDIUM, index: true },
  resolution: { type: String, trim: true, maxlength: 2000, default: "" }, internalNotes: { type: String, trim: true, maxlength: 2000, default: "" },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, resolvedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ customer: 1, createdAt: -1 }); schema.index({ status: 1, priority: 1, createdAt: -1 });
export default mongoose.model("Complaint", schema);
