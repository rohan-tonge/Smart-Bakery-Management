import mongoose from "mongoose";
import { UNITS, WASTAGE_REASONS, WASTAGE_TYPES } from "../utils/constants.js";

const wastageRecordSchema = new mongoose.Schema({
  productionBatch: { type: mongoose.Schema.Types.ObjectId, ref: "ProductionBatch", required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  productVariant: { type: mongoose.Schema.Types.ObjectId, required: true },
  productSnapshot: { productName: { type: String, required: true }, variantName: { type: String, required: true } },
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", default: null },
  ingredientNameSnapshot: { type: String, default: "" },
  inventoryLot: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryLot", default: null },
  lotNumberSnapshot: { type: String, default: "" },
  purchase: { type: mongoose.Schema.Types.ObjectId, ref: "Purchase", default: null },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
  supplierNameSnapshot: { type: String, default: "" },
  inventoryTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryTransaction", default: null },
  quantity: { type: Number, required: true, min: 0.000001 },
  unit: { type: String, enum: Object.values(UNITS), required: true },
  type: { type: String, enum: Object.values(WASTAGE_TYPES), required: true },
  reason: { type: String, enum: Object.values(WASTAGE_REASONS), required: true },
  valuePaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: 0 },
  valueBasis: { type: String, enum: ["LOT_COST", "PRODUCTION_COST", "NOT_VALUED"], default: "NOT_VALUED" },
  idempotencyKey: { type: String, trim: true, maxlength: 120, default: undefined },
  requestFingerprint: { type: String, default: "" },
  notes: { type: String, trim: true, maxlength: 1000, default: "" },
  status: { type: String, enum: ["PROCESSING", "RECORDED"], default: "PROCESSING" },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recordedAt: { type: Date, default: Date.now },
}, { timestamps: true });

wastageRecordSchema.index({ productionBatch: 1, type: 1 }, { unique: true, partialFilterExpression: { type: "PRODUCTION_OUTPUT" } });
wastageRecordSchema.index({ recordedAt: -1, type: 1 });
wastageRecordSchema.index({ status: 1, recordedAt: -1 });
wastageRecordSchema.index({ recordedBy: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });

export const WastageRecord = mongoose.model("WastageRecord", wastageRecordSchema);
export default WastageRecord;
