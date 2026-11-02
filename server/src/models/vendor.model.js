import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 160, unique: true },
  contactPerson: { type: String, trim: true, maxlength: 120, default: "" },
  phone: { type: String, trim: true, maxlength: 30, default: "" },
  email: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
  address: { type: String, trim: true, maxlength: 1000, default: "" },
  gstNumber: { type: String, trim: true, uppercase: true, maxlength: 15, default: "" },
  notes: { type: String, trim: true, maxlength: 2000, default: "" },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

vendorSchema.index({ isActive: 1 });

export const Vendor = mongoose.model("Vendor", vendorSchema);
export default Vendor;
