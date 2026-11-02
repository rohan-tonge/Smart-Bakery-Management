import mongoose from "mongoose";
import { NOTIFICATION_TYPES } from "../utils/constants.js";
const schema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: Object.values(NOTIFICATION_TYPES), required: true }, title: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, trim: true, maxlength: 500 }, relatedEntityType: { type: String, trim: true, maxlength: 40, default: "" },
  relatedEntityId: { type: mongoose.Schema.Types.ObjectId, default: null }, metadata: { type: mongoose.Schema.Types.Mixed, default: {} }, dedupeKey: { type: String, default: undefined }, readAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ recipient: 1, createdAt: -1 }); schema.index({ recipient: 1, readAt: 1 }); schema.index({ recipient: 1, type: 1, createdAt: -1 }); schema.index({ recipient: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
export default mongoose.model("Notification", schema);
