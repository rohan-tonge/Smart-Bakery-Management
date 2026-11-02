import mongoose from "mongoose";
import { UNITS } from "../utils/constants.js";

export const REQUISITION_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  ISSUED: "ISSUED",
});

const issuedLotSchema = new mongoose.Schema(
  {
    lot: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryLot", required: true },
    lotNumber: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.000001 },
    unit: { type: String, enum: Object.values(UNITS), required: true },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryTransaction", default: null },
  },
  { _id: false },
);

const requisitionItemSchema = new mongoose.Schema(
  {
    ingredient: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
    name: { type: String, required: true, trim: true },
    requiredQuantity: { type: Number, required: true, min: 0.000001 },
    requestedQuantity: { type: Number, required: true, min: 0.000001 },
    approvedQuantity: { type: Number, min: 0, default: null },
    issuedQuantity: { type: Number, min: 0, default: null },
    unit: { type: String, enum: Object.values(UNITS), required: true },
    adjustmentReason: { type: String, trim: true, maxlength: 500, default: "" },
    issuedLots: { type: [issuedLotSchema], default: [] },
  },
  { _id: false },
);

const ingredientRequisitionSchema = new mongoose.Schema(
  {
    requisitionNumber: { type: String, required: true, unique: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "ProductionBatch", required: true, index: true },
    batchNumber: { type: String, required: true, trim: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true, trim: true },
    productVariant: { type: mongoose.Schema.Types.ObjectId, default: null },
    variantName: { type: String, trim: true, default: "" },
    relatedOrders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
    requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    requesterName: { type: String, required: true, trim: true },
    items: {
      type: [requisitionItemSchema],
      required: true,
      validate: [(val) => Array.isArray(val) && val.length > 0, "At least one ingredient item is required"],
    },
    status: {
      type: String,
      enum: Object.values(REQUISITION_STATUS),
      default: REQUISITION_STATUS.PENDING,
      index: true,
    },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    rejectionReason: { type: String, trim: true, maxlength: 1000, default: "" },
    approvalNotes: { type: String, trim: true, maxlength: 1000, default: "" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    issuedAt: { type: Date, default: null },
    requestedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

ingredientRequisitionSchema.index({ batch: 1, status: 1 });
ingredientRequisitionSchema.index({ requester: 1, status: 1 });
ingredientRequisitionSchema.index({ createdAt: -1 });

export const IngredientRequisition = mongoose.model(
  "IngredientRequisition",
  ingredientRequisitionSchema,
);
export default IngredientRequisition;
