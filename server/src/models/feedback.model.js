import mongoose from "mongoose";
const criterionSchema = new mongoose.Schema({
  name: { type: String, trim: true, required: true, maxlength: 50 },
  rating: { type: Number, min: 1, max: 5, required: true },
}, { _id: false });
const schema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  variant: { type: mongoose.Schema.Types.ObjectId, required: true },
  productNameSnapshot: { type: String, required: true }, variantNameSnapshot: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5, required: true }, comment: { type: String, trim: true, maxlength: 1000, default: "" },
  criteria: { type: [criterionSchema], default: [] },
  tags: { type: [{ type: String, trim: true, maxlength: 40 }], default: [] },
  photoReference: { type: String, trim: true, maxlength: 2048, default: "" },
  status: { type: String, enum: ["PENDING", "APPROVED", "HIDDEN"], default: "APPROVED", index: true },
}, { timestamps: true });
schema.index({ customer: 1, order: 1, product: 1, variant: 1 }, { unique: true });
schema.index({ product: 1, variant: 1, status: 1, createdAt: -1 });
schema.index({ customer: 1, createdAt: -1 }); schema.index({ status: 1, createdAt: -1 });
export default mongoose.model("Feedback", schema);
