import mongoose from "mongoose";

const schema = new mongoose.Schema({ _id: { type: String, required: true }, sequence: { type: Number, required: true, min: 0 } }, { versionKey: false });
export const ProductionBatchCounter = mongoose.model("ProductionBatchCounter", schema);
export default ProductionBatchCounter;
