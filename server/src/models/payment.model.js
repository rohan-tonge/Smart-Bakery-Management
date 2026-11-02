import mongoose from "mongoose";

export const PAYMENT_STATUSES = Object.freeze(["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"]);
const paymentSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, enum: ["RAZORPAY"], default: "RAZORPAY", required: true },
  providerOrderId: { type: String, trim: true, default: null, index: true },
  providerPaymentId: { type: String, trim: true, default: null, index: true },
  amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }, // currency subunits (paise for INR)
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  status: { type: String, enum: PAYMENT_STATUSES, default: "CREATED", required: true, index: true },
  activeOrderKey: { type: String, default: undefined },
  capturedOrderKey: { type: String, default: undefined },
  method: { type: String, default: null },
  failureReason: { type: String, maxlength: 500, default: "" },
  capturedAt: { type: Date, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  verifiedAt: { type: Date, default: null },
}, { timestamps: true });
paymentSchema.index({ activeOrderKey: 1 }, { unique: true, partialFilterExpression: { activeOrderKey: { $type: "string" } } });
paymentSchema.index({ capturedOrderKey: 1 }, { unique: true, partialFilterExpression: { capturedOrderKey: { $type: "string" } } });
paymentSchema.index({ customer: 1, createdAt: -1 });
paymentSchema.index({ order: 1, createdAt: -1 });
paymentSchema.index({ order: 1, status: 1 });

export const Payment = mongoose.model("Payment", paymentSchema);
export default Payment;
