import mongoose from "mongoose";

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100, unique: true },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  description: { type: String, trim: true, maxlength: 1000, default: "" },
  image: { type: String, trim: true, default: "" },
  imageUrl: { type: String, trim: true, maxlength: 2000, default: "" },
  isActive: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, min: 0, default: 0 },
}, { timestamps: true });

categorySchema.index({ sortOrder: 1, name: 1 });

export const Category = mongoose.model("Category", categorySchema);
export default Category;
