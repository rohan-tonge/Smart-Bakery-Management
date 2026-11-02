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
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";
import {
  getBakeryTodayString,
  getBakeryTomorrowString,
  isDateNextDayOrLater,
} from "../src/utils/date.utils.js";

test("Next-Day-Onward Ordering, Mandatory Customer Info & Conditional Payment Verification", async (t) => {
  await connectToDb();
  await Order.init();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create Owner/Manager user
  const ownerUser = await User.create({
    name: "Owner Test",
    email: `owner-${suffix}@nextdaytest.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER_MANAGER,
    isActive: true,
  });
  const ownerToken = generateAccessToken(ownerUser);
  const ownerAuth = { Authorization: `Bearer ${ownerToken}` };

  // Create test category and product
  const category = await Category.create({
    name: `Test Pastry ${suffix}`,
    slug: `test-pastry-${suffix}`,
    sortOrder: 1,
    isActive: true,
  });

  const product = await Product.create({
    name: `Croissant ${suffix}`,
    slug: `croissant-${suffix}`,
    category: category._id,
    isActive: true,
    isAvailable: true,
    variants: [
      {
        name: "Butter",
        quantity: 1,
        unit: "piece",
        price: 80,
        isActive: true,
        isAvailable: true,
      },
    ],
  });
  const variantId = product.variants[0]._id;

  // On-hand finished stock
  await FinishedProductStock.create({
    product: product._id,
    variant: variantId,
    onHandQuantity: 50,
    reservedQuantity: 0,
    updatedBy: ownerUser._id,
  });

  const todayStr = getBakeryTodayString();
  const tomorrowStr = getBakeryTomorrowString();
  const pastDateStr = "2024-01-01";
  const createdOrderIds = [];

  t.after(async () => {
    if (createdOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: createdOrderIds } });
    }
    await FinishedProductStock.deleteMany({ product: product._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteOne({ _id: ownerUser._id });
    await disconnectDb();
  });

  // 1. Next-Day Date Helper tests
  await t.test("1. Date utilities strictly enforce next-day calendar validation", () => {
    assert.equal(isDateNextDayOrLater(todayStr), false, "Today must be rejected");
    assert.equal(isDateNextDayOrLater(pastDateStr), false, "Past date must be rejected");
    assert.equal(isDateNextDayOrLater("invalid-date"), false, "Invalid format must be rejected");
    assert.equal(isDateNextDayOrLater(tomorrowStr), true, "Tomorrow must be accepted");
  });

  // 2. Reject Today and Past Dates at Checkout API
  await t.test("2. Backend order creation strictly rejects today and past delivery dates", async () => {
    const guestCartId = `guest-cart-${suffix}`;

    // Add item to cart
    await request(app)
      .post("/api/v1/cart/items")
      .set("x-guest-id", guestCartId)
      .send({ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 });

    // Attempt checkout with today's date
    const todayRes = await request(app)
      .post("/api/v1/orders")
      .set("x-guest-id", guestCartId)
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: todayStr,
        contactName: "Priya Sharma",
        contactPhone: "9876543210",
      });
    assert.equal(todayRes.status, 400);
    assert.match(
      JSON.stringify(todayRes.body),
      /Orders must be scheduled at least one day in advance/i
    );

    // Attempt checkout with past date
    const pastRes = await request(app)
      .post("/api/v1/orders")
      .set("x-guest-id", guestCartId)
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: pastDateStr,
        contactName: "Priya Sharma",
        contactPhone: "9876543210",
      });
    assert.equal(pastRes.status, 400);
    assert.match(
      JSON.stringify(pastRes.body),
      /Orders must be scheduled at least one day in advance/i
    );

    // Attempt checkout with omitted deliveryDate
    const missingDateRes = await request(app)
      .post("/api/v1/orders")
      .set("x-guest-id", guestCartId)
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        contactName: "Priya Sharma",
        contactPhone: "9876543210",
      });
    assert.equal(missingDateRes.status, 400);
    assert.match(
      JSON.stringify(missingDateRes.body),
      /Please select a delivery\/pickup date/i
    );
  });

  // 3. Customer Name and Phone Number Mandatory
  await t.test("3. Customer name and 10-digit phone number are strictly mandatory", async () => {
    const guestCartId = `guest-contact-${suffix}`;

    // Missing contactName
    const missingName = await request(app)
      .post("/api/v1/orders")
      .set("x-guest-id", guestCartId)
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactPhone: "9876543210",
        items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
      });
    assert.equal(missingName.status, 400);
    assert.match(JSON.stringify(missingName.body), /Customer name is required/i);

    // Empty whitespace contactName
    const whitespaceName = await request(app)
      .post("/api/v1/orders")
      .set("x-guest-id", guestCartId)
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactName: "    ",
        contactPhone: "9876543210",
        items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
      });
    assert.equal(whitespaceName.status, 400);

    // Missing phone number
    const missingPhone = await request(app)
      .post("/api/v1/orders")
      .set("x-guest-id", guestCartId)
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactName: "Amit Patel",
        items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
      });
    assert.equal(missingPhone.status, 400);
    assert.match(JSON.stringify(missingPhone.body), /Phone number is required/i);

    // Invalid phone number (< 10 digits)
    const shortPhone = await request(app)
      .post("/api/v1/orders")
      .set("x-guest-id", guestCartId)
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactName: "Amit Patel",
        contactPhone: "12345",
        items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
      });
    assert.equal(shortPhone.status, 400);
    assert.match(JSON.stringify(shortPhone.body), /at least 10 digits/i);
  });

  // 4. Address Required ONLY for Doorstep Delivery
  await t.test("4. Address is mandatory for Delivery and disallowed for Pickup", async () => {
    // Delivery without address is rejected
    const deliveryNoAddress = await request(app)
      .post("/api/v1/orders")
      .send({
        orderType: "DELIVERY",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactName: "Deepa Verma",
        contactPhone: "9876543210",
        items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
      });
    assert.equal(deliveryNoAddress.status, 400);
    assert.match(JSON.stringify(deliveryNoAddress.body), /delivery address/i);

    // Pickup with address is rejected
    const pickupWithAddress = await request(app)
      .post("/api/v1/orders")
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactName: "Deepa Verma",
        contactPhone: "9876543210",
        deliveryAddress: {
          addressLine1: "12 MG Road",
          city: "Bengaluru",
          postalCode: "560001",
        },
        items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
      });
    assert.equal(pickupWithAddress.status, 400);
    assert.match(JSON.stringify(pickupWithAddress.body), /not allowed for pickup/i);

    // Pickup WITHOUT address succeeds
    const pickupSuccess = await request(app)
      .post("/api/v1/orders")
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactName: "Deepa Verma",
        contactPhone: "9876543210",
        items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
      });
    assert.equal(pickupSuccess.status, 201, JSON.stringify(pickupSuccess.body));
    const pickupOrder = pickupSuccess.body.data.order;
    assert.equal(pickupOrder.orderType, "PICKUP");
    assert.equal(pickupOrder.deliveryAddress, null);
    assert.equal(pickupOrder.contactName, "Deepa Verma");
    assert.equal(pickupOrder.contactPhone, "9876543210");
    createdOrderIds.push(pickupOrder._id);

    // Delivery WITH complete address succeeds
    const deliverySuccess = await request(app)
      .post("/api/v1/orders")
      .send({
        orderType: "DELIVERY",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactName: "Deepa Verma",
        contactPhone: "9876543210",
        deliveryAddress: {
          addressLine1: "12 MG Road",
          city: "Bengaluru",
          postalCode: "560001",
        },
        items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
      });
    assert.equal(deliverySuccess.status, 201, JSON.stringify(deliverySuccess.body));
    const deliveryOrder = deliverySuccess.body.data.order;
    assert.equal(deliveryOrder.orderType, "DELIVERY");
    assert.equal(deliveryOrder.deliveryAddress.addressLine1, "12 MG Road");
    assert.equal(deliveryOrder.deliveryAddress.city, "Bengaluru");
    createdOrderIds.push(deliveryOrder._id);
  });

  // 5. Conditional Payment Verification: First-time vs Returning Customer
  await t.test("5. Payment screenshot is mandatory for first-time customer, optional for returning customer", async () => {
    // 5A. First-time customer without screenshot fails
    const firstTimeCheckout = await request(app)
      .post("/api/v1/orders")
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactName: "First Timer",
        contactPhone: `911000${Math.floor(1000 + Math.random() * 9000)}`,
        items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
      });
    assert.equal(firstTimeCheckout.status, 201);
    const firstOrder = firstTimeCheckout.body.data.order;
    createdOrderIds.push(firstOrder._id);

    // Attempt to mark paid without screenshot or reference
    const noScreenshotRes = await request(app)
      .post(`/api/v1/orders/${firstOrder._id}/mark-paid`)
      .send({
        amount: firstOrder.total,
        token: firstOrder.guestTrackingToken,
      });
    assert.equal(noScreenshotRes.status, 400);
    assert.match(JSON.stringify(noScreenshotRes.body), /screenshot/i);

    // Upload with valid screenshot
    // 1x1 transparent PNG in base64
    const validPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const withScreenshotRes = await request(app)
      .post(`/api/v1/orders/${firstOrder._id}/mark-paid`)
      .send({
        screenshot: validPng,
        mimeType: "image/png",
        fileName: "upi_receipt.png",
        amount: firstOrder.total,
        token: firstOrder.guestTrackingToken,
      });
    assert.equal(withScreenshotRes.status, 200);
    assert.equal(withScreenshotRes.body.data.order.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(withScreenshotRes.body.data.order.paymentProof.hasProof, true);

    // 5B. Returning customer (with isReturningCustomer flag or recognized contact phone) can skip screenshot
    const returningCheckout = await request(app)
      .post("/api/v1/orders")
      .send({
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
        contactName: "First Timer",
        contactPhone: firstOrder.contactPhone, // Same phone number = recognized returning customer!
        items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
      });
    assert.equal(returningCheckout.status, 201);
    const returningOrder = returningCheckout.body.data.order;
    createdOrderIds.push(returningOrder._id);

    // Returning customer submits mark-paid without screenshot
    const skipScreenshotRes = await request(app)
      .post(`/api/v1/orders/${returningOrder._id}/mark-paid`)
      .send({
        amount: returningOrder.total,
        token: returningOrder.guestTrackingToken,
        isReturningCustomer: true,
      });
    assert.equal(skipScreenshotRes.status, 200, JSON.stringify(skipScreenshotRes.body));
    // Order moves to PENDING_VERIFICATION (NOT automatically marked paid/confirmed)
    assert.equal(skipScreenshotRes.body.data.order.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(skipScreenshotRes.body.data.order.status, "PENDING_PAYMENT");

    // Owner manually verifies the returning customer order
    const ownerConfirmRes = await request(app)
      .patch(`/api/v1/orders/${returningOrder._id}/confirm-payment`)
      .set(ownerAuth)
      .send({ note: "Verified bank statement directly" });
    assert.equal(ownerConfirmRes.status, 200);
    assert.equal(ownerConfirmRes.body.data.order.paymentStatus, "PAYMENT_CONFIRMED");
    assert.equal(ownerConfirmRes.body.data.order.status, "CONFIRMED");
  });
});
