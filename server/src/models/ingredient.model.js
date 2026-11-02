import mongoose from "mongoose";
import { UNITS } from "../utils/constants.js";

const ingredientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  description: { type: String, trim: true, maxlength: 1000, default: "" },
  unit: { type: String, required: true, enum: Object.values(UNITS) },
  minimumStock: { type: Number, min: 0, default: 0 },
  reorderLevel: { type: Number, min: 0, default: 0 },
  // Cached quantity reserved by active customer orders, expressed in `unit`.
  reservedStock: { type: Number, min: 0, default: 0 },
  productionReservedStock: { type: Number, min: 0, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

ingredientSchema.index({ name: 1 });
ingredientSchema.index({ unit: 1 });
ingredientSchema.index({ isActive: 1 });

export const Ingredient = mongoose.model("Ingredient", ingredientSchema);
export default Ingredient;
