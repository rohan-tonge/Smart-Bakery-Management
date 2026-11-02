process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import Order from "../src/models/order.model.js";
import Payment from "../src/models/payment.model.js";
import PaymentEvent from "../src/models/paymentEvent.model.js";
import InventoryTransaction from "../src/models/inventoryTransaction.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { paymentService, toSubunits } from "../src/services/payment.service.js";
import { USER_ROLES } from "../src/utils/constants.js";

test("Phase 7: Razorpay payment creation, verification, ownership, and webhook idempotency", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = {};
  for (const role of [USER_ROLES.CUSTOMER, USER_ROLES.OWNER]) {
    const user = await User.create({ name: `Payment ${role}`, email: `${role.toLowerCase()}-${suffix}@payments-test.com`, password: "Password123!", role });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });
  const category = await Category.create({ name: `Pay Cat ${suffix}`, slug: `pay-cat-${suffix}` });
  const product = await Product.create({
    name: `Pay Product ${suffix}`,
    slug: `pay-product-${suffix}`,
    category: category._id,
    isActive: true,
    isAvailable: true,
    variants: [{ name: "Standard", quantity: 1, unit: "piece", price: 456.78, isActive: true, isAvailable: true }],
  });
  const variantId = product.variants[0]._id;
  await FinishedProductStock.create({
    product: product._id,
    variant: variantId,
    onHandQuantity: 1000,
    reservedQuantity: 0,
    updatedBy: users[USER_ROLES.OWNER].user._id,
  });
  const createdEvents = [];
  const createdOrderIds = [];
  let calls = 0;
  paymentService.setGatewayForTests({
    async createOrder(data) { calls += 1; return { id: `order_test_${suffix}_${calls}`, amount: data.amount, currency: data.currency, receipt: data.receipt }; },
    async fetchPayment(paymentId) { return { id: paymentId, order_id: this.providerOrderId, amount: this.amount, currency: "INR", status: "captured", method: "card" }; },
  }, { keyId: "rzp_test_public", keySecret: `key-${suffix}`, webhookSecret: `hook-${suffix}`, currency: "INR" });
  const makeOrder = async (customer = users[USER_ROLES.CUSTOMER].user._id, total = 456.78) => {
    const order = await Order.create({
      orderNumber: `ORD-TEST-${suffix}-${createdOrderIds.length}`,
      customer,
      items: [{ productId: product._id, variantId, productName: product.name, variantName: "Standard", quantity: 1, unitPrice: total, lineTotal: total }],
      subtotal: total,
      discount: 0,
      tax: 0,
      deliveryFee: 0,
      total,
      orderType: "PICKUP",
      contactName: "Customer",
      contactPhone: "9876543210",
      status: "PENDING_PAYMENT",
      reservationExpiresAt: new Date(Date.now() + 600000),
    });
    createdOrderIds.push(order._id); return order;
  };
  const checkoutSignature = (orderId, paymentId) => crypto.createHmac("sha256", `key-${suffix}`).update(`${orderId}|${paymentId}`).digest("hex");
  t.after(async () => {
    paymentService.resetGateway();
    const payments = await Payment.find({ customer: { $in: Object.values(users).map((u) => u.user._id) } }).select("_id");
    await PaymentEvent.deleteMany({ providerEventId: { $in: createdEvents } });
    await Payment.deleteMany({ _id: { $in: payments.map((p) => p._id) } });
    await Order.deleteMany({ _id: { $in: createdOrderIds } });
    await FinishedProductStock.deleteMany({ product: product._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@payments-test\\.com$`) });
    await disconnectDb();
  });

  await t.test("creates server-priced Razorpay orders and reuses active attempts", async () => {
    assert.equal(toSubunits(456.78), 45678);
    assert.equal(toSubunits(0.1), 10);
    assert.throws(() => toSubunits(1.005), /smaller than one paise/);
    const order = await makeOrder();
    const tampered = await request(app).post("/api/v1/payments/create").set(auth(USER_ROLES.CUSTOMER)).send({ orderId: order._id, amount: 1 });
    assert.equal(tampered.status, 400);
    const first = await request(app).post("/api/v1/payments/create").set(auth(USER_ROLES.CUSTOMER)).send({ orderId: order._id });
    assert.equal(first.status, 201);
    assert.equal(first.body.data.amount, 45678); assert.equal(first.body.data.currency, "INR");
    assert.equal(first.body.data.keyId, "rzp_test_public");
    assert.equal(first.body.data.razorpayOrderId, `order_test_${suffix}_1`);
    const second = await request(app).post("/api/v1/payments/create").set(auth(USER_ROLES.CUSTOMER)).send({ orderId: order._id });
    assert.equal(second.body.data.paymentId, first.body.data.paymentId); assert.equal(calls, 1);
    assert.equal(JSON.stringify(first.body).includes(`key-${suffix}`), false);
    assert.equal(JSON.stringify(first.body).includes(`hook-${suffix}`), false);
    assert.equal((await Payment.findById(first.body.data.paymentId)).providerOrderId, first.body.data.razorpayOrderId);
    assert.equal((await request(app).post("/api/v1/payments/create").set(auth(USER_ROLES.OWNER)).send({ orderId: order._id })).status, 403);
    const other = await makeOrder(new mongoose.Types.ObjectId());
    assert.equal((await request(app).post("/api/v1/payments/create").set(auth(USER_ROLES.CUSTOMER)).send({ orderId: other._id })).status, 404);
  });

  await t.test("validates checkout signatures, confirms only captured payments, and is idempotent", async () => {
    let info;
    paymentService.setGatewayForTests({
      async createOrder(data) { calls += 1; return { id: `order_test_${suffix}_verify_${calls}`, amount: data.amount, currency: data.currency }; },
      async fetchPayment(id) { return { id, order_id: info.razorpayOrderId, amount: info.amount, currency: info.currency, status: "captured", method: "card" }; },
    }, { keyId: "rzp_test_public", keySecret: `key-${suffix}`, webhookSecret: `hook-${suffix}`, currency: "INR" });
    const order = await makeOrder();
    const created = await request(app).post("/api/v1/payments/create").set(auth(USER_ROLES.CUSTOMER)).send({ orderId: order._id });
    info = created.body.data;
    const providerPaymentId = `pay_test_${suffix}_verify`;
    const invalid = await request(app).post("/api/v1/payments/verify").set(auth(USER_ROLES.CUSTOMER)).send({ razorpay_order_id: info.razorpayOrderId, razorpay_payment_id: providerPaymentId, razorpay_signature: "a".repeat(64) });
    assert.equal(invalid.status, 401); assert.equal((await Order.findById(order._id)).status, "PENDING_PAYMENT");
    const payload = { razorpay_order_id: info.razorpayOrderId, razorpay_payment_id: providerPaymentId, razorpay_signature: checkoutSignature(info.razorpayOrderId, providerPaymentId) };
    const inventoryTransactionCount = await InventoryTransaction.countDocuments({});
    const verified = await request(app).post("/api/v1/payments/verify").set(auth(USER_ROLES.CUSTOMER)).send(payload);
    assert.equal(verified.status, 200); assert.equal(verified.body.data.payment.status, "CAPTURED");
    assert.equal((await Order.findById(order._id)).status, "CONFIRMED");
    const duplicate = await request(app).post("/api/v1/payments/verify").set(auth(USER_ROLES.CUSTOMER)).send(payload);
    assert.equal(duplicate.status, 200);
    assert.equal(await Payment.countDocuments({ order: order._id }), 1);
    assert.equal(await InventoryTransaction.countDocuments({}), inventoryTransactionCount);
    assert.equal((await request(app).get(`/api/v1/payments/${verified.body.data.payment._id}`).set(auth(USER_ROLES.OWNER))).status, 200);
    const stranger = await User.create({ name: "Stranger", email: `stranger-${suffix}@payments-test.com`, password: "Password123!", role: USER_ROLES.CUSTOMER });
    const strangerToken = generateAccessToken(stranger);
    assert.equal((await request(app).get(`/api/v1/payments/${verified.body.data.payment._id}`).set({ Authorization: `Bearer ${strangerToken}` })).status, 404);
    await User.deleteOne({ _id: stranger._id });
  });

  await t.test("verifies raw webhook signatures, updates failures, and ignores duplicate event delivery", async () => {
    paymentService.setGatewayForTests({
      async createOrder(data) { calls += 1; return { id: `order_test_${suffix}_webhook_${calls}`, amount: data.amount, currency: data.currency }; },
      async fetchPayment(id) { return { id, order_id: "", amount: 0, currency: "INR", status: "failed" }; },
    }, { keyId: "rzp_test_public", keySecret: `key-${suffix}`, webhookSecret: `hook-${suffix}`, currency: "INR" });
    const order = await makeOrder();
    const created = await request(app).post("/api/v1/payments/create").set(auth(USER_ROLES.CUSTOMER)).send({ orderId: order._id });
    const info = created.body.data;
    const providerPaymentId = `pay_test_${suffix}_webhook`;
    const eventId = `evt_test_${suffix}`; createdEvents.push(eventId);
    const event = { event: "payment.captured", payload: { payment: { entity: { id: providerPaymentId, order_id: info.razorpayOrderId, amount: info.amount, currency: "INR", status: "captured", method: "card" } } } };
    const raw = JSON.stringify(event);
    const signature = crypto.createHmac("sha256", `hook-${suffix}`).update(raw).digest("hex");
    const first = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", signature).set("x-razorpay-event-id", eventId).set("Content-Type", "application/json").send(raw);
    assert.equal(first.status, 200); assert.equal((await Order.findById(order._id)).status, "CONFIRMED");
    const replay = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", signature).set("x-razorpay-event-id", eventId).set("Content-Type", "application/json").send(raw);
    assert.equal(replay.status, 200); assert.equal(replay.body.data.duplicate, true);
    const failedOrder = await makeOrder();
    const failedCreate = await request(app).post("/api/v1/payments/create").set(auth(USER_ROLES.CUSTOMER)).send({ orderId: failedOrder._id });
    const failedInfo = failedCreate.body.data;
    const failEventId = `evt_failed_${suffix}`; createdEvents.push(failEventId);
    const failure = { event: "payment.failed", payload: { payment: { entity: { id: `pay_failed_${suffix}`, order_id: failedInfo.razorpayOrderId, amount: failedInfo.amount, currency: "INR", status: "failed", error_description: "Declined" } } } };
    const rawFailure = JSON.stringify(failure);
    const failSig = crypto.createHmac("sha256", `hook-${suffix}`).update(rawFailure).digest("hex");
    const failedResponse = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", failSig).set("x-razorpay-event-id", failEventId).set("Content-Type", "application/json").send(rawFailure);
    assert.equal(failedResponse.status, 200);
    assert.equal((await Order.findById(failedOrder._id)).status, "PENDING_PAYMENT");
    assert.equal((await Payment.findOne({ order: failedOrder._id })).status, "FAILED");
    const retry = await request(app).post("/api/v1/payments/create").set(auth(USER_ROLES.CUSTOMER)).send({ orderId: failedOrder._id });
    assert.equal(retry.status, 201);
    assert.notEqual(retry.body.data.paymentId, failedCreate.body.data.paymentId);
    const failedAttempt = await Payment.findById(failedCreate.body.data.paymentId);
    const lateCapturedEventId = `evt_late_capture_${suffix}`; createdEvents.push(lateCapturedEventId);
    const lateCapture = { event: "payment.captured", payload: { payment: { entity: { id: `pay_late_${suffix}`, order_id: failedAttempt.providerOrderId, amount: failedAttempt.amount, currency: failedAttempt.currency, status: "captured" } } } };
    const rawLateCapture = JSON.stringify(lateCapture);
    const lateCaptureSignature = crypto.createHmac("sha256", `hook-${suffix}`).update(rawLateCapture).digest("hex");
    const lateCaptureResponse = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", lateCaptureSignature).set("x-razorpay-event-id", lateCapturedEventId).set("Content-Type", "application/json").send(rawLateCapture);
    assert.equal(lateCaptureResponse.status, 200);
    const secondCaptureEventId = `evt_second_capture_${suffix}`; createdEvents.push(secondCaptureEventId);
    const secondCapture = { event: "payment.captured", payload: { payment: { entity: { id: `pay_retry_${suffix}`, order_id: retry.body.data.razorpayOrderId, amount: retry.body.data.amount, currency: retry.body.data.currency, status: "captured" } } } };
    const rawSecondCapture = JSON.stringify(secondCapture);
    const secondCaptureSignature = crypto.createHmac("sha256", `hook-${suffix}`).update(rawSecondCapture).digest("hex");
    const secondCaptureResponse = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", secondCaptureSignature).set("x-razorpay-event-id", secondCaptureEventId).set("Content-Type", "application/json").send(rawSecondCapture);
    assert.equal(secondCaptureResponse.status, 409);
    assert.equal(await Payment.countDocuments({ order: failedOrder._id, status: "CAPTURED" }), 1);
    const badSignature = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", "0".repeat(64)).set("x-razorpay-event-id", `evt_bad_${suffix}`).send(event);
    assert.equal(badSignature.status, 401);
    assert.equal((await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", signature).send(event)).status, 400);
  });

  await t.test("a captured event cannot revive a cancelled order", async () => {
    const order = await makeOrder();
    const created = await request(app).post("/api/v1/payments/create").set(auth(USER_ROLES.CUSTOMER)).send({ orderId: order._id });
    const info = created.body.data;
    const cancelled = await request(app).post(`/api/v1/orders/${order._id}/cancel`).set(auth(USER_ROLES.CUSTOMER)).send({ reason: "Cancelled before payment" });
    assert.equal(cancelled.status, 200);
    const eventId = `evt_cancelled_capture_${suffix}`; createdEvents.push(eventId);
    const event = { event: "payment.captured", payload: { payment: { entity: { id: `pay_cancelled_${suffix}`, order_id: info.razorpayOrderId, amount: info.amount, currency: info.currency, status: "captured" } } } };
    const raw = JSON.stringify(event);
    const signature = crypto.createHmac("sha256", `hook-${suffix}`).update(raw).digest("hex");
    const response = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", signature).set("x-razorpay-event-id", eventId).set("Content-Type", "application/json").send(raw);
    assert.equal(response.status, 200);
    assert.equal((await Order.findById(order._id)).status, "CANCELLED");
    const payment = await Payment.findById(info.paymentId);
    assert.equal(payment.status, "CAPTURED");
    assert.equal(payment.metadata.captureNeedsReconciliation, true);
  });
});
