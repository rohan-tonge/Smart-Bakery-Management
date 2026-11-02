import mongoose from "mongoose";

const requisitionCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, default: 0 },
});

export const RequisitionCounter = mongoose.model(
  "RequisitionCounter",
  requisitionCounterSchema,
);
export default RequisitionCounter;
