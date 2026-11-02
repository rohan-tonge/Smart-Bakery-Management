import mongoose from "mongoose";

const productVariantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  quantity: { type: Number, required: true, min: 0.001 },
  unit: { type: String, required: true, enum: ["g", "kg", "ml", "L", "piece"] },
  price: { type: Number, required: true, min: 0 },
  isAvailable: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  description: { type: String, trim: true, maxlength: 3000, default: "" },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  images: { type: [String], default: [] },
  imageUrl: { type: String, trim: true, maxlength: 2000, default: "" },
  basePrice: { type: Number, min: 0, default: null },
  isAvailable: { type: Boolean, default: true, index: true },
  isActive: { type: Boolean, default: true, index: true },
  preparationTime: { type: Number, min: 0, default: 0 },
  productionTime: { type: Number, min: 0, default: 0 },
  preparationTimePerUnit: { type: Number, min: 0, default: 0 },
  totalTimeMinutes: { type: Number, min: 0, default: undefined },
  electricityCostPerUnit: { type: Number, min: 0, default: 0 },
  packagingCostPerUnit: { type: Number, min: 0, default: 0 },
  tags: { type: [String], default: [] },
  variants: { type: [productVariantSchema], default: [] },
}, {
  timestamps: true,
  toJSON: {
    transform: (_doc, ret) => {
      const combined = (ret.totalTimeMinutes !== undefined && ret.totalTimeMinutes !== null)
        ? ret.totalTimeMinutes
        : ((ret.preparationTime || 0) + (ret.productionTime || 0));
      ret.totalTimeMinutes = combined;
      ret.preparationTimePerUnit = ret.preparationTimePerUnit ?? ret.preparationTime ?? 0;
      ret.electricityCostPerUnit = ret.electricityCostPerUnit ?? 0;
      ret.packagingCostPerUnit = ret.packagingCostPerUnit ?? 0;
      return ret;
    },
  },
  toObject: {
    transform: (_doc, ret) => {
      const combined = (ret.totalTimeMinutes !== undefined && ret.totalTimeMinutes !== null)
        ? ret.totalTimeMinutes
        : ((ret.preparationTime || 0) + (ret.productionTime || 0));
      ret.totalTimeMinutes = combined;
      ret.preparationTimePerUnit = ret.preparationTimePerUnit ?? ret.preparationTime ?? 0;
      ret.electricityCostPerUnit = ret.electricityCostPerUnit ?? 0;
      ret.packagingCostPerUnit = ret.packagingCostPerUnit ?? 0;
      return ret;
    },
  },
});

productSchema.index({ name: 1 });
productSchema.index({ category: 1, isActive: 1, isAvailable: 1 });

export const Product = mongoose.model("Product", productSchema);
export default Product;
