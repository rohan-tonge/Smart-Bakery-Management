process.env.NODE_ENV = "test";

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import Order from "../src/models/order.model.js";
import Setting from "../src/models/setting.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";
import { getBakeryTomorrowString } from "../src/utils/date.utils.js";

test("Phase Guest & Manual UPI: Public catalog, Guest cart, Manual UPI & Tracking", async (t) => {
  await connectToDb();
  await Order.init();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tomorrowStr = getBakeryTomorrowString();
  const testUtr = `UPI${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toUpperCase()}`;

  // Create Owner/Manager user
  const ownerUser = await User.create({
    name: "Bakery Owner Manager",
    email: `owner-${suffix}@guesttest.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER_MANAGER,
    isActive: true,
  });
  const ownerToken = generateAccessToken(ownerUser);
  const ownerAuth = { Authorization: `Bearer ${ownerToken}` };

  // Create category and product
  const category = await Category.create({
    name: `Guest Bread ${suffix}`,
    slug: `guest-bread-${suffix}`,
    sortOrder: 1,
    isActive: true,
  });

  const product = await Product.create({
    name: `Sourdough Loaf ${suffix}`,
    slug: `sourdough-loaf-${suffix}`,
    category: category._id,
    isActive: true,
    isAvailable: true,
    variants: [
      {
        name: "Regular",
        quantity: 1,
        unit: "piece",
        price: 150,
        isActive: true,
        isAvailable: true,
      },
    ],
  });
  const variantId = product.variants[0]._id;

  await FinishedProductStock.create({
    product: product._id,
    variant: variantId,
    onHandQuantity: 50,
    reservedQuantity: 0,
    updatedBy: ownerUser._id,
  });

  t.after(async () => {
    await Product.deleteMany({ _id: product._id });
    await Category.deleteMany({ _id: category._id });
    await User.deleteMany({ email: new RegExp(suffix) });
    await Order.deleteMany({ contactPhone: { $in: ["9988776655", "9988776657"] } });
    await Setting.deleteMany({ key: "payment_qr" });
    await disconnectDb();
  });

  const guestId = `guest-${suffix}`;

  // 1. Public catalog access without Authorization
  await t.test("1. Public visitor can browse categories and products without JWT", async () => {
    const catRes = await request(app).get("/api/v1/categories");
    assert.equal(catRes.status, 200);
    assert.ok(Array.isArray(catRes.body.data.categories));

    const prodRes = await request(app).get("/api/v1/products");
    assert.equal(prodRes.status, 200);
    assert.ok(Array.isArray(prodRes.body.data.products));

    const singleProdRes = await request(app).get(`/api/v1/products/${product._id}`);
    assert.equal(singleProdRes.status, 200);
    assert.equal(singleProdRes.body.data.product.name, product.name);
  });

  // 2. Owner can configure payment QR settings
  await t.test("2. Owner/Manager can configure payment QR and public can read it", async () => {
    // Configure QR
    const putRes = await request(app)
      .put("/api/v1/settings/payment-qr")
      .set(ownerAuth)
      .send({
        upiId: "bakery@upi",
        payeeName: "Smart Artisan Bakery",
        qrImageUrl: "https://example.com/qr.png",
        instructions: "Please mention order number in UPI remarks",
      });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.data.upiId, "bakery@upi");
    assert.equal(putRes.body.data.isPlaceholder, false);
    assert.match(putRes.body.data.qrData, /pa=bakery%40upi/);

    // Public gets payment QR without token
    const publicQrRes = await request(app).get("/api/v1/settings/payment-qr");
    assert.equal(publicQrRes.status, 200);
    assert.equal(publicQrRes.body.data.upiId, "bakery@upi");
    assert.equal(publicQrRes.body.data.payeeName, "Smart Artisan Bakery");
    assert.equal(publicQrRes.body.data.isPlaceholder, false);
  });

  // 3. Guest cart operations using x-guest-id
  await t.test("3. Unauthenticated guest can add and view cart items via x-guest-id", async () => {
    const addRes = await request(app)
      .post("/api/v1/cart/items")
      .set("x-guest-id", guestId)
      .send({
        productId: product._id.toString(),
        variantId: variantId.toString(),
        quantity: 2,
      });
    assert.equal(addRes.status, 200);
    assert.equal(addRes.body.data.subtotal, 300);

    const getRes = await request(app)
      .get("/api/v1/cart")
      .set("x-guest-id", guestId);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.cart.items.length, 1);
    assert.equal(getRes.body.data.cart.items[0].quantity, 2);
  });

  let createdOrderId = "";
  let createdOrderNumber = "";
  let guestTrackingToken = "";

  // 4. Guest checkout without login using MANUAL_UPI
  await t.test("4. Guest checkout without login using MANUAL_UPI", async () => {
    const checkoutRes = await request(app)
      .post("/api/v1/orders")
      .set("x-guest-id", guestId)
      .send({
        orderType: "DELIVERY",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactPhone: "9988776655",
        contactName: "Walk-in Guest",
        deliveryAddress: {
          addressLine1: "42 Baker Street",
          city: "Pune",
          state: "Maharashtra",
          postalCode: "411001",
        },
      });

    assert.equal(checkoutRes.status, 201);
    const order = checkoutRes.body.data.order;
    assert.equal(order.isGuest, true);
    assert.equal(order.paymentMethod, "MANUAL_UPI");
    assert.equal(order.paymentStatus, "PAYMENT_PENDING");
    assert.equal(order.status, "PENDING_PAYMENT");
    assert.ok(order.guestTrackingToken);

    createdOrderId = order._id;
    createdOrderNumber = order.orderNumber;
    guestTrackingToken = order.guestTrackingToken;
  });

  // 5. Guest submits a UPI reference without being allowed to verify payment
  await t.test("5. Guest reference remains pending verification and requires the tracking token", async () => {
    const missingToken = await request(app).post(`/api/v1/orders/${createdOrderId}/mark-paid`).send({ transactionReference: testUtr, amount: 300 });
    assert.equal(missingToken.status, 403);
    const tamperedAmount = await request(app).post(`/api/v1/orders/${createdOrderId}/mark-paid`).send({
      transactionReference: testUtr, amount: 1, token: guestTrackingToken,
    });
    assert.equal(tamperedAmount.status, 409);
    const markRes = await request(app)
      .post(`/api/v1/orders/${createdOrderId}/mark-paid`)
      .send({
        transactionReference: testUtr,
        amount: 300,
        trackingToken: guestTrackingToken,
      });

    assert.equal(markRes.status, 200);
    assert.equal(markRes.body.data.order.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(markRes.body.data.order.status, "PENDING_PAYMENT");
    assert.equal(markRes.body.data.order.paymentReference, testUtr);
    assert.equal(markRes.body.data.order.paymentReportedAmount, 300);
    const bypass = await request(app).patch(`/api/v1/orders/${createdOrderId}/status`).set(ownerAuth).send({ status: "CONFIRMED" });
    assert.equal(bypass.status, 409);
  });

  await t.test("duplicate UTRs on different orders are rejected", async () => {
    const second = await request(app).post("/api/v1/orders").set("x-guest-id", guestId).send({
      orderType: "PICKUP", paymentMethod: "MANUAL_UPI", contactPhone: "9988776656", contactName: "Guest Two", deliveryDate: tomorrowStr,
      items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
    });
    assert.equal(second.status, 201, second.body.message);
    const secondId = second.body.data.order._id;
    const duplicate = await request(app).post(`/api/v1/orders/${secondId}/mark-paid`).send({ transactionReference: testUtr.toLowerCase(), amount: 150, token: second.body.data.order.guestTrackingToken });
    assert.equal(duplicate.status, 409);
    await Order.deleteOne({ _id: secondId });
    await FinishedProductStock.updateOne({ product: product._id, variant: variantId }, { $inc: { reservedQuantity: -1 } });
  });

  await t.test("owner rejection cancels a pending UPI order and releases its reservation once", async () => {
    const created = await request(app).post("/api/v1/orders").set("x-guest-id", guestId).send({
      orderType: "PICKUP", paymentMethod: "MANUAL_UPI", contactPhone: "9988776657", contactName: "Guest Three", deliveryDate: tomorrowStr,
      items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
    });
    assert.equal(created.status, 201, created.body.message);
    const rejectedOrder = created.body.data.order;
    const marked = await request(app).post(`/api/v1/orders/${rejectedOrder._id}/mark-paid`).send({
      transactionReference: "UPIREJECT123", amount: 150, token: rejectedOrder.guestTrackingToken,
    });
    assert.equal(marked.status, 200, marked.body.message);

    const stock = await FinishedProductStock.findOne({ product: product._id, variant: variantId });
    const reservedBeforeRejection = stock.reservedQuantity;
    const rejected = await request(app).patch(`/api/v1/orders/${rejectedOrder._id}/reject-payment`).set(ownerAuth).send({ note: "Reference not found in bank statement" });
    assert.equal(rejected.status, 200, rejected.body.message);
    assert.equal(rejected.body.data.order.status, "CANCELLED");
    assert.equal(rejected.body.data.order.paymentStatus, "PAYMENT_REJECTED");
    assert.equal((await FinishedProductStock.findOne({ product: product._id, variant: variantId })).reservedQuantity, reservedBeforeRejection - 1);

    const retried = await request(app).patch(`/api/v1/orders/${rejectedOrder._id}/reject-payment`).set(ownerAuth).send({ note: "Retry" });
    assert.equal(retried.status, 200);
    assert.equal((await FinishedProductStock.findOne({ product: product._id, variant: variantId })).reservedQuantity, reservedBeforeRejection - 1);
    await Order.deleteOne({ _id: rejectedOrder._id });
  });

  // 6. Public guest order tracking
  await t.test("6. Guest can track order using orderNumber and contactPhone", async () => {
    const trackRes = await request(app).get(
      `/api/v1/orders/track?orderNumber=${createdOrderNumber}&phone=9988776655`
    );
    assert.equal(trackRes.status, 200);
    assert.equal(trackRes.body.data.orderNumber, createdOrderNumber);
    assert.equal(trackRes.body.data.paymentStatus, "PENDING_VERIFICATION");

    // Invalid phone fails
    const badTrackRes = await request(app).get(
      `/api/v1/orders/track?orderNumber=${createdOrderNumber}&phone=1111111111`
    );
    assert.equal(badTrackRes.status, 403);
  });

  // 7. Owner confirms manual UPI payment
  await t.test("7. Owner/Manager confirms payment and order moves to CONFIRMED", async () => {
    const confirmRes = await request(app)
      .patch(`/api/v1/orders/${createdOrderId}/confirm-payment`)
      .set(ownerAuth)
      .send({
        note: "Verified in bank account statement",
      });

    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.data.order.paymentStatus, "PAYMENT_CONFIRMED");
    assert.equal(confirmRes.body.data.order.status, "CONFIRMED");
  });

  // 8. Security verification: CUSTOMER and PRODUCTION_STAFF cannot access OWNER_MANAGER endpoints
  await t.test("8. Security verification: Non-owner roles are rejected with 403 on management endpoints", async () => {
    const custUser = await User.create({
      name: "Customer Security Test",
      email: `cust-sec-${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.CUSTOMER,
      isActive: true,
    });
    const custAuth = { Authorization: `Bearer ${generateAccessToken(custUser)}` };

    const staffUser = await User.create({
      name: "Staff Security Test",
      email: `staff-sec-${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.PRODUCTION_STAFF,
      isActive: true,
    });
    const staffAuth = { Authorization: `Bearer ${generateAccessToken(staffUser)}` };

    // Customer & Staff cannot change payment QR
    const custQr = await request(app).put("/api/v1/settings/payment-qr").set(custAuth).send({ upiId: "hack@upi", payeeName: "Hacker" });
    assert.equal(custQr.status, 403);
    const staffQr = await request(app).put("/api/v1/settings/payment-qr").set(staffAuth).send({ upiId: "hack@upi", payeeName: "Hacker" });
    assert.equal(staffQr.status, 403);

    // Customer & Staff cannot confirm payments
    const custConfirm = await request(app).patch(`/api/v1/orders/${createdOrderId}/confirm-payment`).set(custAuth).send({ note: "Try confirm" });
    assert.equal(custConfirm.status, 403);
    const staffConfirm = await request(app).patch(`/api/v1/orders/${createdOrderId}/confirm-payment`).set(staffAuth).send({ note: "Try confirm" });
    assert.equal(staffConfirm.status, 403);

    // Customer & Staff cannot list all orders
    const custOrders = await request(app).get("/api/v1/orders").set(custAuth);
    assert.equal(custOrders.status, 403);
    const staffOrders = await request(app).get("/api/v1/orders").set(staffAuth);
    assert.equal(staffOrders.status, 403);

    // Clean up
    await User.deleteMany({ _id: { $in: [custUser._id, staffUser._id] } });
  });
});
