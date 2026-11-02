import mongoose from "mongoose";
import { INVENTORY_TRANSACTION_TYPES, UNITS } from "../utils/constants.js";

const inventoryTransactionSchema = new mongoose.Schema({
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
  lot: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryLot", required: true },
  type: { type: String, enum: [...Object.values(INVENTORY_TRANSACTION_TYPES), "WASTAGE"], required: true },
  quantity: { type: Number, required: true, min: 0.000001 },
  unit: { type: String, required: true, enum: Object.values(UNITS) },
  direction: { type: String, enum: ["IN", "OUT"], required: true },
  referenceType: { type: String, enum: ["PURCHASE", "ADJUSTMENT", "PRODUCTION", "WASTAGE"], required: true },
  referenceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  reason: { type: String, trim: true, maxlength: 500, default: "" },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

inventoryTransactionSchema.index({ ingredient: 1, createdAt: -1 });
inventoryTransactionSchema.index({ lot: 1, createdAt: -1 });
inventoryTransactionSchema.index({ type: 1, createdAt: -1 });
inventoryTransactionSchema.index({ createdAt: 1 });
inventoryTransactionSchema.index({ referenceType: 1, referenceId: 1 });
inventoryTransactionSchema.index({ referenceId: 1, ingredient: 1, lot: 1, type: 1 }, {
  unique: true,
  partialFilterExpression: { referenceType: "PRODUCTION" },
});
inventoryTransactionSchema.index({ referenceId: 1 }, { unique: true, partialFilterExpression: { referenceType: "WASTAGE" } });

export const InventoryTransaction = mongoose.model("InventoryTransaction", inventoryTransactionSchema);
export default InventoryTransaction;
