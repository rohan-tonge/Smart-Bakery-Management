process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import path from "node:path";
import fs from "node:fs/promises";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import Recipe from "../src/models/recipe.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import Order from "../src/models/order.model.js";
import PaymentProof from "../src/models/paymentProof.model.js";
import Cart from "../src/models/cart.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";

// Valid synthetic test 1x1 PNG image
const SYNTHETIC_PNG_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SYNTHETIC_PNG_RAW = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("Owner Payment Screenshot Viewing & Authorization Regression Suite", async (t) => {
  await connectToDb();
  const suffix = `proofview-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create test users
  const owner = await User.create({
    name: `Owner ${suffix}`,
    email: `owner-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER_MANAGER,
  });
  const ownerToken = generateAccessToken(owner);

  const staff = await User.create({
    name: `Staff ${suffix}`,
    email: `staff-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
  });
  const staffToken = generateAccessToken(staff);

  const customer = await User.create({
    name: `Customer ${suffix}`,
    email: `customer-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
  });
  const customerToken = generateAccessToken(customer);

  const otherCustomer = await User.create({
    name: `Other Customer ${suffix}`,
    email: `other-customer-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
  });
  const otherCustomerToken = generateAccessToken(otherCustomer);

  // Setup catalog item & stock
  const category = await Category.create({ name: `ProofCat ${suffix}`, slug: `proofcat-${suffix}` });
  const product = await Product.create({
    name: `ProofProduct ${suffix}`,
    slug: `proofproduct-${suffix}`,
    category: category._id,
    preparationTime: 15,
    productionTime: 25,
    variants: [{ name: "Standard", quantity: 1, unit: "piece", price: 250 }],
  });
  const variant = product.variants[0];

  const flour = await Ingredient.create({
    name: `Ing ${suffix}`,
    slug: `ing-${suffix}`,
    unit: "g",
    costPerUnit: 0.1,
  });
  await InventoryLot.create({
    ingredient: flour._id,
    lotNumber: `LOT-PROOF-${suffix}`,
    originalQuantity: 10000,
    remainingQuantity: 10000,
    unit: "g",
    unitCost: 0.1,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });
  await Recipe.create({
    product: product._id,
    variant: variant._id,
    ingredients: [{ ingredient: flour._id, quantity: 100, unit: "g" }],
    expectedYield: 1,
    yieldUnit: "piece",
    preparationTime: 15,
    productionTime: 25,
  });
  await FinishedProductStock.create({
    product: product._id,
    variant: variant._id,
    onHandQuantity: 20,
    reservedQuantity: 0,
    updatedBy: owner._id,
  });

  t.after(async () => {
    await PaymentProof.deleteMany({ order: { $exists: true } });
    await Order.deleteMany({
      $or: [{ contactEmail: new RegExp(suffix) }, { orderNumber: new RegExp(suffix) }],
    });
    await FinishedProductStock.deleteMany({ product: product._id });
    await Recipe.deleteMany({ product: product._id });
    await InventoryLot.deleteMany({ lotNumber: new RegExp(suffix) });
    await Ingredient.deleteOne({ _id: flour._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ email: new RegExp(suffix) });
    await Cart.deleteMany({ customer: { $in: [customer._id, otherCustomer._id] } });
    await disconnectDb();
  });

  let customerOrderId = null;
  let guestOrderId = null;
  let guestTrackingToken = null;
  const tomorrowStr = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);

  await t.test("1. Create customer UPI order and upload synthetic payment screenshot", async () => {
    // Add item to cart
    await request(app)
      .post("/api/v1/cart/items")
      .set({ Authorization: `Bearer ${customerToken}` })
      .send({ productId: product._id, variantId: variant._id, quantity: 1 });

    // Place UPI order
    const orderRes = await request(app)
      .post("/api/v1/orders")
      .set({ Authorization: `Bearer ${customerToken}` })
      .send({
        orderType: "PICKUP",
        contactName: "Proof Customer",
        contactPhone: "9876543210",
        contactEmail: `proof-cust-${suffix}@test.com`,
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
      });

    assert.equal(orderRes.status, 201);
    customerOrderId = orderRes.body.data.order._id;
    assert.equal(orderRes.body.data.order.paymentMethod, "MANUAL_UPI");
    assert.equal(orderRes.body.data.order.paymentStatus, "PAYMENT_PENDING");

    // Upload screenshot
    const uploadRes = await request(app)
      .post(`/api/v1/orders/${customerOrderId}/mark-paid`)
      .set({ Authorization: `Bearer ${customerToken}` })
      .send({
        screenshot: SYNTHETIC_PNG_BASE64,
        amount: orderRes.body.data.order.total,
        mimeType: "image/png",
        fileName: "upi_receipt.png",
      });

    assert.equal(uploadRes.status, 200);
    assert.equal(uploadRes.body.data.order.paymentStatus, "PENDING_VERIFICATION");
    assert.ok(uploadRes.body.data.order.paymentProof);
    assert.equal(uploadRes.body.data.order.paymentProof.hasProof, true);
  });

  await t.test("2. Owner retrieves payment screenshot and receives valid image binary with metadata headers", async () => {
    const res = await request(app)
      .get(`/api/v1/orders/${customerOrderId}/payment-proof`)
      .set({ Authorization: `Bearer ${ownerToken}` });

    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/png");
    assert.equal(res.headers["cache-control"], "private, no-cache, no-store, must-revalidate");
    assert.ok(res.headers["content-disposition"].includes("inline; filename="));
    assert.equal(res.headers["x-payment-proof-mime-type"], "image/png");
    assert.ok(Number(res.headers["x-payment-proof-size"]) > 0);
    assert.ok(res.headers["x-payment-proof-uploaded-at"]);

    // Verify binary data matches uploaded image
    assert.ok(Buffer.isBuffer(res.body));
    assert.deepEqual(res.body, SYNTHETIC_PNG_RAW);
  });

  await t.test("3. Production staff is strictly denied access (403 Forbidden)", async () => {
    const res = await request(app)
      .get(`/api/v1/orders/${customerOrderId}/payment-proof`)
      .set({ Authorization: `Bearer ${staffToken}` });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.ok(res.body.message.includes("Access denied"));
  });

  await t.test("4. Unrelated customer is strictly denied access (403 Forbidden)", async () => {
    const res = await request(app)
      .get(`/api/v1/orders/${customerOrderId}/payment-proof`)
      .set({ Authorization: `Bearer ${otherCustomerToken}` });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.ok(res.body.message.includes("Access denied"));
  });

  await t.test("5. Unauthenticated request without token is denied (403 Forbidden)", async () => {
    const res = await request(app).get(`/api/v1/orders/${customerOrderId}/payment-proof`);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });

  await t.test("6. Customer who placed the order can view their own payment screenshot", async () => {
    const res = await request(app)
      .get(`/api/v1/orders/${customerOrderId}/payment-proof`)
      .set({ Authorization: `Bearer ${customerToken}` });

    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/png");
    assert.deepEqual(res.body, SYNTHETIC_PNG_RAW);
  });

  await t.test("7. Guest UPI order: valid tracking token grants access, invalid token is rejected", async () => {
    const guestCartId = `guest_proof_${suffix}`;
    await request(app)
      .post("/api/v1/cart/items")
      .set({ "x-guest-id": guestCartId })
      .send({ productId: product._id, variantId: variant._id, quantity: 1 });

    const orderRes = await request(app)
      .post("/api/v1/orders")
      .set({ "x-guest-id": guestCartId })
      .send({
        orderType: "PICKUP",
        contactName: "Guest Proof Buyer",
        contactPhone: "9123456789",
        contactEmail: `guest-${suffix}@test.com`,
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
      });

    assert.equal(orderRes.status, 201);
    guestOrderId = orderRes.body.data.order._id;
    guestTrackingToken = orderRes.body.data.order.guestTrackingToken;

    // Upload guest screenshot
    const uploadRes = await request(app)
      .post(`/api/v1/orders/${guestOrderId}/mark-paid`)
      .send({
        token: guestTrackingToken,
        screenshot: SYNTHETIC_PNG_BASE64,
        amount: orderRes.body.data.order.total,
        mimeType: "image/png",
        fileName: "guest_receipt.png",
      });

    assert.equal(uploadRes.status, 200);

    // Invalid guest token fails with 403
    const badGuestRes = await request(app)
      .get(`/api/v1/orders/${guestOrderId}/payment-proof?token=invalid_token_12345`);
    assert.equal(badGuestRes.status, 403);

    // Valid guest token succeeds with 200
    const goodGuestRes = await request(app)
      .get(`/api/v1/orders/${guestOrderId}/payment-proof?token=${guestTrackingToken}`);
    assert.equal(goodGuestRes.status, 200);
    assert.equal(goodGuestRes.headers["content-type"], "image/png");

    // Owner can also view the guest's proof
    const ownerGuestRes = await request(app)
      .get(`/api/v1/orders/${guestOrderId}/payment-proof`)
      .set({ Authorization: `Bearer ${ownerToken}` });
    assert.equal(ownerGuestRes.status, 200);
  });

  await t.test("8. Image is served directly from MongoDB even if disk file is removed", async () => {
    // If a disk file was written, remove it
    const proofDoc = await PaymentProof.findOne({ order: customerOrderId });
    assert.ok(proofDoc);
    if (proofDoc.fileName) {
      const diskPath = path.resolve("uploads/payment-proofs", proofDoc.fileName);
      try {
        await fs.unlink(diskPath);
      } catch {}
    }

    // Owner request still succeeds because MongoDB buffer is authoritative
    const res = await request(app)
      .get(`/api/v1/orders/${customerOrderId}/payment-proof`)
      .set({ Authorization: `Bearer ${ownerToken}` });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, SYNTHETIC_PNG_RAW);
  });

  await t.test("9. Expired or purged screenshot returns HTTP 410 Gone with retention explanation", async () => {
    // Simulate automatic 30-day purge by nullifying data and marking isDeleted
    const proofDoc = await PaymentProof.findOne({ order: customerOrderId });
    proofDoc.data = null;
    proofDoc.isDeleted = true;
    proofDoc.deletedAt = new Date();
    await proofDoc.save();

    const res = await request(app)
      .get(`/api/v1/orders/${customerOrderId}/payment-proof`)
      .set({ Authorization: `Bearer ${ownerToken}` });

    assert.equal(res.status, 410);
    assert.equal(res.body.success, false);
    assert.ok(res.body.message.includes("automatically deleted after 30 days"));
    assert.ok(res.body.message.includes("retention policy"));
  });
});
