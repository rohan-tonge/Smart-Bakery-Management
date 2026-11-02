import mongoose from "mongoose";
import { CUSTOMER_ORDER_STATUSES, ORDER_TYPES } from "../utils/constants.js";

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  productName: { type: String, required: true, trim: true },
  variantName: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
  unitPrice: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 },
  specialInstructions: { type: String, trim: true, maxlength: 500, default: "" },
  packInstructions: { type: String, trim: true, maxlength: 500, default: "" },
}, { _id: false });

const addressSchema = new mongoose.Schema({
  addressLine1: { type: String, required: true, trim: true, maxlength: 200 },
  addressLine2: { type: String, trim: true, maxlength: 200, default: "" },
  city: { type: String, required: true, trim: true, maxlength: 100 },
  state: { type: String, trim: true, maxlength: 100, default: "" },
  postalCode: { type: String, required: true, trim: true, maxlength: 20 },
}, { _id: false });

const ingredientCommitmentSchema = new mongoose.Schema({
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true },
}, { _id: false });

const finishedCommitmentSchema = new mongoose.Schema({
  stock: { type: mongoose.Schema.Types.ObjectId, ref: "FinishedProductStock", required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  variant: { type: mongoose.Schema.Types.ObjectId, required: true },
  quantity: { type: Number, required: true, min: 0.000001 },
}, { _id: false });

const capacityCommitmentSchema = new mongoose.Schema({
  date: { type: String, match: /^\d{8}$/ },
  minutes: { type: Number, min: 1 },
  released: { type: Boolean, default: false },
}, { _id: false });

const deliverySlotReservationSchema = new mongoose.Schema({
  token: { type: String, default: null },
  date: { type: String, default: null },
  timeSlot: { type: String, default: null },
  orderType: { type: String, default: null },
  released: { type: Boolean, default: false },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  isGuest: { type: Boolean, default: false, index: true },
  guestId: { type: String, trim: true, default: undefined, index: true },
  guestTrackingToken: { type: String, default: null, index: true },
  items: { type: [orderItemSchema], required: true, validate: [(items) => items.length > 0, "An order must contain at least one item"] },
  subtotal: { type: Number, required: true, min: 0 },
  discount: { type: Number, min: 0, default: 0 },
  tax: { type: Number, min: 0, default: 0 },
  deliveryFee: { type: Number, min: 0, default: 0 },
  total: { type: Number, required: true, min: 0 },
  orderType: { type: String, enum: Object.values(ORDER_TYPES), required: true },
  deliveryDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null, index: true },
  deliveryTimeSlot: { type: String, trim: true, default: null },
  paymentMethod: { type: String, enum: ["COD", "RAZORPAY", "MANUAL_UPI", "PAY_ON_DELIVERY"], default: "MANUAL_UPI" },
  paymentStatus: {
    type: String,
    enum: [
      "PAYMENT_PENDING",
      "CUSTOMER_MARKED_PAID",
      "PENDING_VERIFICATION",
      "PAYMENT_REJECTED",
      "PAYMENT_CONFIRMED",
      "PENDING",
      "SUCCESS",
      "FAILED",
      "REFUNDED",
    ],
    default: "PAYMENT_PENDING",
    index: true,
  },
  paymentReference: { type: String, trim: true, default: "" },
  paymentReferenceKey: { type: String, trim: true, default: undefined },
  paymentReportedAmount: { type: Number, min: 0, default: null },
  customerPaidAt: { type: Date, default: null },
  paymentConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  paymentConfirmedAt: { type: Date, default: null },
  paymentProof: {
    proofId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentProof", default: null },
    fileName: { type: String, default: null },
    mimeType: { type: String, default: null },
    fileSize: { type: Number, default: null },
    uploadedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    hasProof: { type: Boolean, default: false },
  },
  deliveryAddress: { type: addressSchema, default: null },
  contactName: { type: String, trim: true, maxlength: 120, default: "Guest Customer" },
  contactPhone: { type: String, required: true, trim: true, maxlength: 30 },
  contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
  specialInstructions: { type: String, trim: true, maxlength: 1000, default: "" },
  packInstructions: { type: String, trim: true, maxlength: 500, default: "" },
  status: { type: String, enum: Object.values(CUSTOMER_ORDER_STATUSES), default: CUSTOMER_ORDER_STATUSES.PENDING_PAYMENT, index: true },
  fulfillmentStatus: {
    type: String,
    enum: ["UNFULFILLED", "PARTIALLY_FULFILLED", "FULFILLED_FROM_STOCK", "IN_PRODUCTION", "FULFILLED"],
    default: "UNFULFILLED",
    index: true,
  },
  feasibilitySnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  ingredientCommitments: { type: [ingredientCommitmentSchema], default: [] },
  finishedCommitments: { type: [finishedCommitmentSchema], default: [] },
  capacityCommitment: { type: capacityCommitmentSchema, default: null },
  deliverySlotReservation: { type: deliverySlotReservationSchema, default: null },
  estimatedReadyAt: { type: Date, default: null },
  reservationExpiresAt: { type: Date, default: null, index: true },
  cancellation: {
    reason: { type: String, trim: true, maxlength: 500, default: "" },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
  },
  holdState: {
    isOnHold: { type: Boolean, default: false, index: true },
    holdReason: { type: String, default: "" },
    holdInstruction: { type: String, default: "" },
    ownerNote: { type: String, default: "" },
    holdRequestedAt: { type: Date, default: null },
    holdRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    instructionVersion: { type: Number, default: 0 },
    bakerAcknowledged: { type: Boolean, default: false },
    bakerAcknowledgedAt: { type: Date, default: null },
    bakerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    holdResolvedAt: { type: Date, default: null },
    holdResolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    holdResolution: { type: String, default: "" },
    resolutionNote: { type: String, default: "" },
    relatedBatch: { type: mongoose.Schema.Types.ObjectId, ref: "ProductionBatch", default: null },
  },
  idempotencyKey: { type: String, default: undefined },
  requestFingerprint: { type: String, default: undefined },
  paymentSummary: {
    status: { type: String, default: null },
    provider: { type: String, default: null },
    providerOrderId: { type: String, default: null },
    providerPaymentId: { type: String, default: null },
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

orderSchema.virtual("fulfillmentSummary").get(function () {
  const items = this.items || [];
  const finishedCommitments = this.finishedCommitments || [];
  let totalRequested = 0;
  let totalFinishedReserved = 0;

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    totalRequested += qty;
    const commitment = finishedCommitments.find(
      (c) => String(c.product) === String(item.productId?._id || item.productId) &&
             String(c.variant) === String(item.variantId)
    );
    totalFinishedReserved += Number(commitment?.quantity) || 0;
  }

  const remainingToProduce = Math.max(0, totalRequested - totalFinishedReserved);
  const isFullyInStock = totalRequested > 0 && remainingToProduce === 0;
  const isPartialStock = totalFinishedReserved > 0 && remainingToProduce > 0;
  const isBlocked = this.feasibilitySnapshot?.feasible === false || ((this.feasibilitySnapshot?.shortages?.length || 0) > 0);

  let type = "REQUIRES_PRODUCTION";
  if (isBlocked) type = "BLOCKED";
  else if (isFullyInStock) type = "FULFILLED_FROM_STOCK";
  else if (isPartialStock) type = "PARTIAL_STOCK";

  return {
    type,
    isFullyInStock,
    isPartialStock,
    isBlocked,
    totalRequested,
    totalFinishedReserved,
    remainingToProduce,
  };
});

orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ createdAt: 1 });
orderSchema.index(
  { customer: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $exists: true },
      customer: { $type: "objectId" },
    },
  }
);
orderSchema.index({ contactPhone: 1, createdAt: -1 });
orderSchema.index({ status: 1, reservationExpiresAt: 1 });
orderSchema.index({ deliveryDate: 1, deliveryTimeSlot: 1 });
orderSchema.index({ paymentReferenceKey: 1 }, { unique: true, sparse: true, name: "uniq_manual_payment_reference" });
orderSchema.index(
  { guestId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { guestId: { $type: "string" }, idempotencyKey: { $type: "string" } },
    name: "uniq_guest_order_idempotency",
  },
);

export const Order = mongoose.model("Order", orderSchema);
export default Order;
