import mongoose from "mongoose";
import { UNITS } from "../utils/constants.js";

const purchaseItemSchema = new mongoose.Schema({
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
  quantity: { type: Number, required: true, min: 0.000001 },
  unit: { type: String, required: true, enum: Object.values(UNITS) },
  unitPrice: { type: Number, required: true, min: 0 },
  totalPrice: { type: Number, required: true, min: 0 },
  lotNumber: { type: String, required: true, trim: true, maxlength: 100 },
  expiryDate: { type: Date, default: null },
}, { _id: true });

const purchaseSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
  purchaseDate: { type: Date, required: true, index: true },
  invoiceNumber: { type: String, trim: true, maxlength: 100, default: undefined },
  items: { type: [purchaseItemSchema], required: true, validate: [(items) => items.length > 0, "A purchase must contain at least one item"] },
  subtotal: { type: Number, required: true, min: 0 },
  tax: { type: Number, min: 0, default: 0 },
  totalAmount: { type: Number, required: true, min: 0 },
  notes: { type: String, trim: true, maxlength: 2000, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

purchaseSchema.index({ vendor: 1, purchaseDate: -1 });
purchaseSchema.index({ createdAt: -1 });
purchaseSchema.index({ vendor: 1, invoiceNumber: 1 }, { unique: true, partialFilterExpression: { invoiceNumber: { $exists: true } } });
purchaseSchema.index({ "items.ingredient": 1 });

export const Purchase = mongoose.model("Purchase", purchaseSchema);
export default Purchase;
