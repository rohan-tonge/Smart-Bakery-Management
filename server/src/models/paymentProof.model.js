import mongoose from "mongoose";

const paymentProofSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
    },
    fileSize: {
      type: Number,
      required: true,
      min: 1,
      max: 10 * 1024 * 1024, // 10MB maximum
    },
    data: {
      type: Buffer,
      default: null, // Nullified when purged after 30 days
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedReason: {
      type: String,
      trim: true,
      maxlength: 255,
      default: null,
    },
  },
  { timestamps: true }
);

paymentProofSchema.index({ expiresAt: 1, isDeleted: 1 });
paymentProofSchema.index({ order: 1, uploadedAt: -1 });

export const PaymentProof = mongoose.model("PaymentProof", paymentProofSchema);
export default PaymentProof;
