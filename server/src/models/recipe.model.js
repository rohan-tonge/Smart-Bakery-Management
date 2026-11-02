import mongoose from "mongoose";
import { UNITS } from "../utils/constants.js";

const recipeIngredientSchema = new mongoose.Schema({
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
  quantity: { type: Number, required: true, min: 0.000001 },
  unit: { type: String, required: true, enum: Object.values(UNITS) },
}, { _id: false });

const recipePackagingMaterialSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  costPerUnit: { type: Number, required: true, min: 0 },
  consumptionType: { type: String, enum: ["PER_PIECE", "PER_BATCH"], default: "PER_PIECE" },
  unitsPerItem: { type: Number, min: 0, default: 1 },
}, { _id: false });

const recipeSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  variant: { type: mongoose.Schema.Types.ObjectId, required: true },
  ingredients: { type: [recipeIngredientSchema], default: [] },
  expectedYield: { type: Number, required: true, min: 0.000001, default: 1 },
  yieldUnit: { type: String, required: true, enum: Object.values(UNITS), default: UNITS.PIECE },
  preparationTime: { type: Number, min: 0, default: 0 },
  productionTime: { type: Number, min: 0, default: 0 },
  estimatedDurationMinutes: { type: Number, min: 1, default: undefined },
  equipmentPowerKw: { type: Number, min: 0, default: undefined },
  electricityTariff: { type: Number, min: 0, default: undefined },
  labourMinutes: { type: Number, min: 0, default: null },
  powerMinutes: { type: Number, min: 0, default: null },
  labourCostPerMinute: { type: Number, min: 0, default: 0 },
  powerCostPerMinute: { type: Number, min: 0, default: 0 },
  packagingCostPerUnit: { type: Number, min: 0, default: 0 },
  packagingQuantity: { type: Number, min: 0, default: 1 },
  packagingMaterials: { type: [recipePackagingMaterialSchema], default: [] },
  instructions: { type: String, trim: true, maxlength: 12000, default: "" },
  isActive: { type: Boolean, default: true },
  // Incremented on each edit. Future production records should store an immutable snapshot
  // of this revision and its ingredient lines rather than reading this mutable document.
  revision: { type: Number, min: 1, default: 1 },
}, { timestamps: true });

recipeSchema.virtual("duration").get(function () {
  return this.estimatedDurationMinutes || ((this.preparationTime || 0) + (this.productionTime || 0));
});

recipeSchema.virtual("totalTimeMinutes").get(function () {
  return this.estimatedDurationMinutes || ((this.preparationTime || 0) + (this.productionTime || 0));
});

recipeSchema.set("toJSON", { virtuals: true });
recipeSchema.set("toObject", { virtuals: true });

recipeSchema.index({ product: 1, variant: 1, isActive: 1 }, {
  unique: true,
  partialFilterExpression: { isActive: true },
});
recipeSchema.index({ isActive: 1 });

export const Recipe = mongoose.model("Recipe", recipeSchema);
export default Recipe;
