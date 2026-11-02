import mongoose from "mongoose";

const stockHistoryEntrySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ["PRODUCTION_OUTPUT", "ORDER_RESERVED", "ORDER_FULFILLED", "ORDER_RELEASED", "MANUAL_ADJUSTMENT"],
    required: true,
  },
  quantity: { type: Number, required: true },
  previousOnHand: { type: Number, required: true },
  newOnHand: { type: Number, required: true },
  previousReserved: { type: Number, required: true },
  newReserved: { type: Number, required: true },
  referenceType: {
    type: String,
    enum: ["PRODUCTION_BATCH", "ORDER", "ADJUSTMENT"],
    required: true,
  },
  referenceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  note: { type: String, default: "" },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const finishedProductStockSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  variant: { type: mongoose.Schema.Types.ObjectId, required: true },
  onHandQuantity: { type: Number, required: true, min: 0, default: 0 },
  reservedQuantity: { type: Number, min: 0, default: 0 },
  history: { type: [stockHistoryEntrySchema], default: [] },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

finishedProductStockSchema.index({ product: 1, variant: 1 }, { unique: true });

export const FinishedProductStock = mongoose.model("FinishedProductStock", finishedProductStockSchema);
export default FinishedProductStock;
