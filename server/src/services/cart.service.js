import mongoose from "mongoose";
import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";
import AppError from "../utils/appError.js";

const getCartFilter = (identity) => {
  if (!identity) throw AppError.badRequest("Customer or guest identifier required");
  if (typeof identity === "object") {
    if (identity.customer) return { customer: identity.customer };
    if (identity.guestId) return { guestId: identity.guestId };
  }
  if (mongoose.isValidObjectId(identity)) {
    return { customer: identity };
  }
  return { guestId: String(identity) };
};

class CartService {
  async get(identity) {
    const filter = getCartFilter(identity);
    const cart = (await Cart.findOne(filter).lean()) || {
      ...filter,
      items: [],
    };
    let subtotal = 0;
    const items = await Promise.all(
      cart.items.map(async (item) => {
        const product = await Product.findById(item.product);
        const variant = product?.variants.id(item.variant);
        const available = Boolean(
          product?.isActive &&
          product.isAvailable &&
          variant?.isActive &&
          variant.isAvailable,
        );
        const unitPrice = available ? variant.price : null;
        const lineTotal =
          unitPrice === null
            ? null
            : Number((unitPrice * item.quantity).toFixed(2));
        if (lineTotal !== null) subtotal += lineTotal;
        return {
          ...item,
          product: product ? { _id: product._id, name: product.name, imageUrl: product.imageUrl || product.images?.[0] || "" } : null,
          variant: variant ? { _id: variant._id, name: variant.name } : null,
          available,
          unitPrice,
          lineTotal,
        };
      }),
    );
    return { cart: { ...cart, items }, subtotal: Number(subtotal.toFixed(2)) };
  }

  async validProduct(productId, variantId) {
    const product = await Product.findById(productId);
    if (!product || !product.isActive || !product.isAvailable)
      throw AppError.badRequest("Product is unavailable");
    const variant = product.variants.id(variantId);
    if (!variant || !variant.isActive || !variant.isAvailable)
      throw AppError.badRequest("Product variant is unavailable");
    return { product, variant };
  }

  async add(identity, data) {
    await this.validProduct(data.productId, data.variantId);
    const filter = getCartFilter(identity);
    const cart = await Cart.findOneAndUpdate(
      filter,
      { $setOnInsert: filter },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const found = cart.items.find(
      (line) =>
        String(line.product) === data.productId &&
        String(line.variant) === data.variantId,
    );
    if (found) {
      found.quantity = Math.min(100, found.quantity + data.quantity);
      if (data.specialInstructions !== undefined)
        found.specialInstructions = data.specialInstructions;
    } else {
      cart.items.push({
        product: data.productId,
        variant: data.variantId,
        quantity: data.quantity,
        specialInstructions: data.specialInstructions || "",
      });
    }
    cart.version += 1;
    await cart.save();
    return this.get(identity);
  }

  async update(identity, itemId, data) {
    const filter = getCartFilter(identity);
    const cart = await Cart.findOne(filter);
    const item = cart?.items.id(itemId);
    if (!item) throw AppError.notFound("Cart item not found");
    if (data.quantity !== undefined) item.quantity = data.quantity;
    if (data.specialInstructions !== undefined)
      item.specialInstructions = data.specialInstructions;
    cart.version += 1;
    await cart.save();
    return this.get(identity);
  }

  async remove(identity, itemId) {
    const filter = getCartFilter(identity);
    const cart = await Cart.findOne(filter);
    if (!cart?.items.id(itemId)) throw AppError.notFound("Cart item not found");
    cart.items.pull(itemId);
    cart.version += 1;
    await cart.save();
    return this.get(identity);
  }

  async clear(identity) {
    const filter = getCartFilter(identity);
    await Cart.findOneAndUpdate(
      filter,
      { $set: { items: [] }, $inc: { version: 1 } },
      { upsert: true, setDefaultsOnInsert: true },
    );
    return this.get(identity);
  }
}
export const cartService = new CartService();
export default cartService;
