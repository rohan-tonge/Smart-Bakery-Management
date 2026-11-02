import mongoose from "mongoose";

const orderCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, min: 0 },
}, { versionKey: false });

export const OrderCounter = mongoose.model("OrderCounter", orderCounterSchema);
export default OrderCounter;
