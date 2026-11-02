import mongoose from "mongoose";

const paymentEventSchema = new mongoose.Schema({
  providerEventId: { type: String, required: true, unique: true, trim: true },
  eventType: { type: String, required: true, trim: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
  status: { type: String, enum: ["PROCESSING", "PROCESSED", "IGNORED", "FAILED"], default: "PROCESSING" },
  processingUntil: { type: Date, default: null, index: true },
  receivedAt: { type: Date, default: Date.now },
  processedAt: { type: Date, default: null },
}, { timestamps: true });

export const PaymentEvent = mongoose.model("PaymentEvent", paymentEventSchema);
export default PaymentEvent;
