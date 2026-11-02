import mongoose from "mongoose";
import { UNITS } from "../utils/constants.js";

export const INVENTORY_LOT_STATUSES = Object.freeze(["AVAILABLE", "DEPLETED", "EXPIRED", "BLOCKED"]);

const inventoryLotSchema = new mongoose.Schema({
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
  purchase: { type: mongoose.Schema.Types.ObjectId, ref: "Purchase", default: null },
  purchaseItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
  lotNumber: { type: String, required: true, trim: true, maxlength: 120 },
  originalQuantity: { type: Number, required: true, min: 0.000001 },
  remainingQuantity: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true, enum: Object.values(UNITS) },
  unitCost: { type: Number, required: true, min: 0, default: 0 },
  purchaseDate: { type: Date, required: true },
  expiryDate: { type: Date, default: null },
  status: { type: String, enum: INVENTORY_LOT_STATUSES, default: "AVAILABLE", index: true },
}, { timestamps: true });

inventoryLotSchema.index({ ingredient: 1, status: 1, expiryDate: 1 });
inventoryLotSchema.index({ purchase: 1 });
inventoryLotSchema.index({ ingredient: 1, purchase: 1, lotNumber: 1 }, { unique: true, partialFilterExpression: { purchase: { $type: "objectId" } } });

export const InventoryLot = mongoose.model("InventoryLot", inventoryLotSchema);
export default InventoryLot;
