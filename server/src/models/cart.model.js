import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  variant: { type: mongoose.Schema.Types.ObjectId, required: true },
  quantity: { type: Number, required: true, min: 1, max: 100, validate: Number.isInteger },
  specialInstructions: { type: String, trim: true, maxlength: 500, default: "" },
}, { timestamps: true });

const cartSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: undefined },
  guestId: { type: String, default: undefined, trim: true },
  items: { type: [cartItemSchema], default: [], validate: [(items) => items.length <= 50, "A cart cannot contain more than 50 lines"] },
  version: { type: Number, min: 0, default: 0 },
}, { timestamps: true });

cartSchema.pre("validate", function (next) {
  if (!this.customer) this.customer = undefined;
  if (!this.guestId) this.guestId = undefined;
  if (!this.customer && !this.guestId) {
    return next(new Error("Either customer or guestId must be provided for a cart"));
  }
  next();
});

cartSchema.index(
  { customer: 1 },
  { unique: true, partialFilterExpression: { customer: { $exists: true, $type: "objectId" } } },
);
cartSchema.index(
  { guestId: 1 },
  { unique: true, partialFilterExpression: { guestId: { $exists: true, $type: "string" } } },
);

export const Cart = mongoose.model("Cart", cartSchema);
export default Cart;
