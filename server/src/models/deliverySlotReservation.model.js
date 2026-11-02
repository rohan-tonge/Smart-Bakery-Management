import mongoose from "mongoose";

const slotReservationItemSchema = new mongoose.Schema(
  {
    token: { type: String, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    orderNumber: { type: String, default: null },
    status: {
      type: String,
      enum: ["RESERVED", "COMMITTED", "RELEASED"],
      default: "RESERVED",
    },
    expiresAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    releasedAt: { type: Date, default: null },
  },
  { _id: false }
);

const deliverySlotReservationSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `${date}_${timeSlot}_${orderType}`
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    timeSlot: { type: String, required: true, trim: true },
    orderType: { type: String, enum: ["DELIVERY", "PICKUP"], default: "DELIVERY" },
    maxCapacity: { type: Number, required: true, default: 5 },
    reservedCount: { type: Number, required: true, default: 0, min: 0 },
    reservations: { type: [slotReservationItemSchema], default: [] },
  },
  { timestamps: true }
);

deliverySlotReservationSchema.index({ date: 1, timeSlot: 1, orderType: 1 });

export const DeliverySlotReservation =
  mongoose.models.DeliverySlotReservation ||
  mongoose.model("DeliverySlotReservation", deliverySlotReservationSchema);

export default DeliverySlotReservation;
