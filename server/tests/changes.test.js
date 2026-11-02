process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import Recipe from "../src/models/recipe.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import InventoryTransaction from "../src/models/inventoryTransaction.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import Order from "../src/models/order.model.js";
import PaymentProof from "../src/models/paymentProof.model.js";
import DeliverySlotReservation from "../src/models/deliverySlotReservation.model.js";
import Setting from "../src/models/setting.model.js";
import Cart from "../src/models/cart.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES, CUSTOMER_ORDER_STATUSES } from "../src/utils/constants.js";
import { recipeCostingService } from "../src/services/recipeCosting.service.js";
import { deliverySlotService } from "../src/services/deliverySlot.service.js";
import { cleanupService } from "../src/services/cleanup.service.js";

// Valid synthetic test images (PNG, JPEG, WebP)
const VALID_BASE64_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const VALID_BASE64_JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const VALID_BASE64_WEBP = "data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AAA/v61gAA/v7///4AA/v61gAA/v7///4AA/v61gAA=";

test("Final Change Request Verification Suite", async (t) => {
  await connectToDb();
  await InventoryLot.deleteMany({ lotNumber: /^LOT-FLOUR/ });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const defaultDeliveryDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF, USER_ROLES.CUSTOMER]) {
    const user = await User.create({
      name: `User ${role} ${suffix}`,
      email: `${role.toLowerCase()}-${suffix}@changes-test.com`,
      password: "Password123!",
      role,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }

  // Create another customer to test isolation
  const otherCustomer = await User.create({
    name: `Other Customer ${suffix}`,
    email: `other-customer-${suffix}@changes-test.com`,
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
  });
  const otherToken = generateAccessToken(otherCustomer);

  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  // Setup product, ingredient, recipe, stock
  const category = await Category.create({ name: `Category ${suffix}`, slug: `cat-${suffix}` });
  const product = await Product.create({
    name: `Cake ${suffix}`,
    slug: `cake-${suffix}`,
    category: category._id,
    preparationTime: 20,
    productionTime: 40,
    variants: [
      { name: "500g", quantity: 500, unit: "g", price: 200 },
      { name: "1kg", quantity: 1, unit: "kg", price: 350 },
    ],
  });
  const variant500g = product.variants[0];
  const variant1kg = product.variants[1];

  const flour = await Ingredient.create({
    name: `Flour ${suffix}`,
    slug: `flour-${suffix}`,
    unit: "g",
    costPerUnit: 0.05, // 5 paise per gram = Rs 50/kg
  });
  const flourLot = await InventoryLot.create({
    ingredient: flour._id,
    lotNumber: `LOT-FLOUR-${suffix}`,
    originalQuantity: 50000,
    remainingQuantity: 50000,
    unit: "g",
    unitCost: 0.05,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  const recipe = await Recipe.create({
    product: product._id,
    variant: variant500g._id,
    ingredients: [{ ingredient: flour._id, quantity: 250, unit: "g" }],
    expectedYield: 2,
    yieldUnit: "piece",
    preparationTime: 20,
    productionTime: 40,
    labourMinutes: 60,
    labourCostPerMinute: 2.5, // Rs 150 total labour
    powerMinutes: 40,
    powerCostPerMinute: 1.0, // Rs 40 total power
    packagingQuantity: 2,
    packagingCostPerUnit: 5.0, // Rs 10 total packaging
  });

  // Finished stock: 50 units on hand
  const stock = await FinishedProductStock.create({
    product: product._id,
    variant: variant500g._id,
    onHandQuantity: 50,
    reservedQuantity: 0,
    updatedBy: users.OWNER.user._id,
  });

  t.after(async () => {
    await PaymentProof.deleteMany({ order: { $exists: true } });
    await Order.deleteMany({
      $or: [
        { contactEmail: new RegExp(suffix) },
        { orderNumber: new RegExp(suffix) },
      ],
    });
    await DeliverySlotReservation.deleteMany({});
    await ProductionBatch.deleteMany({ product: product._id });
    await Recipe.deleteMany({ product: product._id });
    await InventoryLot.deleteMany({ $or: [{ ingredient: flour._id }, { lotNumber: new RegExp(suffix) }] });
    await InventoryTransaction.deleteMany({ ingredient: flour._id });
    await FinishedProductStock.deleteMany({ product: product._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await Ingredient.deleteOne({ _id: flour._id });
    await User.deleteMany({ email: new RegExp(suffix) });
    await Cart.deleteMany({ customer: { $in: [users.CUSTOMER.user._id, otherCustomer._id] } });
    await disconnectDb();
  });

  // =========================================================================
  // 1. Screenshot-Based Manual UPI Payment Verification & Retention Cleanup
  // =========================================================================
  await t.test("Requirement 1: Screenshot-based UPI upload, verification, access control, and 30-day retention cleanup", async () => {
    // Add item to cart
    await request(app)
      .post("/api/v1/cart/items")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({ productId: product._id, variantId: variant500g._id, quantity: 1 });

    // Checkout with MANUAL_UPI
    const checkoutRes = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        orderType: "PICKUP",
        contactName: "UPI Customer",
        contactPhone: "9876543210",
        contactEmail: `upi-${suffix}@test.com`,
        paymentMethod: "MANUAL_UPI",
        deliveryDate: defaultDeliveryDate,
      });

    assert.equal(checkoutRes.status, 201);
    const orderId = checkoutRes.body.data.order._id;
    assert.equal(checkoutRes.body.data.order.paymentMethod, "MANUAL_UPI");
    assert.equal(checkoutRes.body.data.order.status, "PENDING_PAYMENT");
    assert.equal(checkoutRes.body.data.order.paymentStatus, "PAYMENT_PENDING");

    // Pre-upload validation tests on order awaiting payment:
    // 1. Invalid MIME type (PDF) is rejected with 400
    const invalidPdfRes = await request(app)
      .post(`/api/v1/orders/${orderId}/mark-paid`)
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        screenshot: "data:application/pdf;base64,JVBERi0xLjQK",
        mimeType: "application/pdf",
        amount: checkoutRes.body.data.order.total,
      });
    assert.equal(invalidPdfRes.status, 400);

    // 2. Corrupted / empty screenshot (<50 bytes) is rejected with 400
    const emptyImgRes = await request(app)
      .post(`/api/v1/orders/${orderId}/mark-paid`)
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        screenshot: "data:image/png;base64,AAAA",
        mimeType: "image/png",
        amount: checkoutRes.body.data.order.total,
      });
    assert.equal(emptyImgRes.status, 400);

    // 3. Upload without screenshot or reference is rejected with 400
    const missingScreenshotRes = await request(app)
      .post(`/api/v1/orders/${orderId}/mark-paid`)
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        amount: checkoutRes.body.data.order.total,
      });
    assert.equal(missingScreenshotRes.status, 400);

    // Upload payment screenshot via JSON base64 payload
    const uploadRes = await request(app)
      .post(`/api/v1/orders/${orderId}/mark-paid`)
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        screenshot: VALID_BASE64_PNG,
        amount: checkoutRes.body.data.order.total,
        mimeType: "image/png",
        fileName: "payment_proof.png",
      });

    assert.equal(uploadRes.status, 200, uploadRes.body.message);
    assert.equal(uploadRes.body.data.order.paymentStatus, "PENDING_VERIFICATION");
    assert.ok(uploadRes.body.data.order.paymentProof);
    assert.ok(uploadRes.body.data.order.paymentProof.fileName);

    // Verify screenshot was saved in PaymentProof collection with 30-day retention
    const proofDoc = await PaymentProof.findOne({ order: orderId });
    assert.ok(proofDoc);
    assert.equal(proofDoc.mimeType, "image/png");
    assert.ok(proofDoc.data);
    assert.ok(proofDoc.expiresAt);
    const daysUntilExpiry = (proofDoc.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    assert.ok(daysUntilExpiry >= 29 && daysUntilExpiry <= 31, "Expires in approx 30 days");

    // Access control on GET /api/v1/orders/:id/payment-proof:
    // a) Other customer gets 403 Forbidden
    const otherRes = await request(app)
      .get(`/api/v1/orders/${orderId}/payment-proof`)
      .set({ Authorization: `Bearer ${otherToken}` });
    assert.equal(otherRes.status, 403);

    // a.1) Production staff gets 403 Forbidden
    const prodStaffRes = await request(app)
      .get(`/api/v1/orders/${orderId}/payment-proof`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(prodStaffRes.status, 403);

    // b) Customer who placed order gets 200 with private cache control
    const ownerCustRes = await request(app)
      .get(`/api/v1/orders/${orderId}/payment-proof`)
      .set(auth(USER_ROLES.CUSTOMER));
    assert.equal(ownerCustRes.status, 200);
    assert.equal(ownerCustRes.headers["content-type"], "image/png");
    assert.equal(ownerCustRes.headers["cache-control"], "private, no-cache, no-store, must-revalidate");

    // c) Manager / Owner gets 200
    const managerRes = await request(app)
      .get(`/api/v1/orders/${orderId}/payment-proof`)
      .set(auth(USER_ROLES.MANAGER));
    assert.equal(managerRes.status, 200);

    // d) Guest Order Payment Proof Upload & Granular Access Control
    const guestCartId = `guest_upi_${suffix}`;
    await request(app)
      .post("/api/v1/cart/items")
      .set({ "x-guest-id": guestCartId })
      .send({ productId: product._id, variantId: variant500g._id, quantity: 1 });

    const guestOrderRes = await request(app)
      .post("/api/v1/orders")
      .set({ "x-guest-id": guestCartId })
      .send({
        orderType: "PICKUP",
        contactName: "Guest UPI Customer",
        contactPhone: "9876543210",
        contactEmail: `guest-upi-${suffix}@test.com`,
        paymentMethod: "MANUAL_UPI",
        deliveryDate: defaultDeliveryDate,
      });
    assert.equal(guestOrderRes.status, 201);
    const guestOrderId = guestOrderRes.body.data.order._id;
    const guestToken = guestOrderRes.body.data.order.guestTrackingToken;
    assert.ok(guestToken, "Guest order must have tracking token");

    // Amount mismatch is rejected
    const mismatchRes = await request(app)
      .post(`/api/v1/orders/${guestOrderId}/mark-paid`)
      .send({
        screenshot: VALID_BASE64_JPEG,
        amount: 9999, // Mismatched amount
        token: guestToken,
        mimeType: "image/jpeg",
      });
    assert.equal(mismatchRes.status, 409);

    // Guest uploads synthetic JPEG screenshot
    const guestUploadRes = await request(app)
      .post(`/api/v1/orders/${guestOrderId}/mark-paid`)
      .send({
        screenshot: VALID_BASE64_JPEG,
        amount: guestOrderRes.body.data.order.total,
        mimeType: "image/jpeg",
        fileName: "guest_receipt.jpg",
        token: guestToken,
      });
    assert.equal(guestUploadRes.status, 200);
    assert.equal(guestUploadRes.body.data.order.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(guestUploadRes.body.data.order.paymentProof.mimeType, "image/jpeg");

    // Guest accesses proof with valid query token -> 200 OK
    const guestTokenFetch = await request(app)
      .get(`/api/v1/orders/${guestOrderId}/payment-proof?token=${guestToken}`);
    assert.equal(guestTokenFetch.status, 200);
    assert.equal(guestTokenFetch.headers["content-type"], "image/jpeg");
    assert.equal(guestTokenFetch.headers["cache-control"], "private, no-cache, no-store, must-revalidate");

    // Guest accesses proof with valid header token -> 200 OK
    const guestHeaderFetch = await request(app)
      .get(`/api/v1/orders/${guestOrderId}/payment-proof`)
      .set({ "x-guest-token": guestToken });
    assert.equal(guestHeaderFetch.status, 200);

    // Unrelated guest with invalid tracking token -> 403 Forbidden
    const invalidTokenFetch = await request(app)
      .get(`/api/v1/orders/${guestOrderId}/payment-proof?token=tampered_guest_token_12345`);
    assert.equal(invalidTokenFetch.status, 403);

    // Anonymous request without token -> 403 Forbidden
    const noTokenFetch = await request(app)
      .get(`/api/v1/orders/${guestOrderId}/payment-proof`);
    assert.equal(noTokenFetch.status, 403);

    // Production staff cannot access guest payment proof -> 403 Forbidden
    const staffGuestFetch = await request(app)
      .get(`/api/v1/orders/${guestOrderId}/payment-proof`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(staffGuestFetch.status, 403);

    // Manager / Owner can access guest payment proof -> 200 OK
    const mgrGuestFetch = await request(app)
      .get(`/api/v1/orders/${guestOrderId}/payment-proof`)
      .set(auth(USER_ROLES.MANAGER));
    assert.equal(mgrGuestFetch.status, 200);

    // Owner approves payment
    const approveRes = await request(app)
      .patch(`/api/v1/orders/${orderId}/confirm-payment`)
      .set(auth(USER_ROLES.OWNER))
      .send({ note: "Verified screenshot against bank statement" });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.body.data.order.paymentStatus, "PAYMENT_CONFIRMED");
    assert.equal(approveRes.body.data.order.status, "CONFIRMED");

    // Test 30-day retention cleanup
    // Simulate customer order screenshot reaching 30-day expiration
    await PaymentProof.updateOne(
      { _id: proofDoc._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } } // expired in past
    );

    // Run cleanup service: first run removes expired proof bytes
    const purgeResult = await cleanupService.cleanupExpiredScreenshots();
    assert.ok(purgeResult.cleanedCount >= 1);

    // Check proof in DB: binary data purged, isDeleted = true, audit timestamps retained
    const cleanedProof = await PaymentProof.findById(proofDoc._id);
    assert.equal(cleanedProof.isDeleted, true);
    assert.equal(cleanedProof.data, null);
    assert.ok(cleanedProof.deletedAt);
    assert.equal(cleanedProof.deletedReason, "AUTOMATIC_30_DAY_RETENTION_CLEANUP");

    // Order record and verification details are preserved intact
    const preservedOrder = await Order.findById(orderId);
    assert.equal(preservedOrder.paymentStatus, "PAYMENT_CONFIRMED");
    assert.equal(preservedOrder.status, "CONFIRMED");
    assert.ok(preservedOrder.paymentConfirmedAt);

    // Attempting to fetch expired screenshot returns 410 Gone with informative policy message
    const expiredFetch = await request(app)
      .get(`/api/v1/orders/${orderId}/payment-proof`)
      .set(auth(USER_ROLES.OWNER));
    assert.equal(expiredFetch.status, 410);
    assert.match(expiredFetch.body.message, /30 days/i);

    // Repeated cleanup is safe and idempotent (returns cleanedCount: 0 without error)
    const idempotentPurge = await cleanupService.cleanupExpiredScreenshots();
    assert.equal(idempotentPurge.cleanedCount, 0);

    // Cleanup with missing local disk file succeeds safely
    const guestProofDoc = await PaymentProof.findOne({ order: guestOrderId });
    assert.ok(guestProofDoc);
    await PaymentProof.updateOne(
      { _id: guestProofDoc._id },
      { $set: { expiresAt: new Date(Date.now() - 1000), fileName: "non_existent_disk_file_test_9999.jpg" } }
    );
    const guestPurgeResult = await cleanupService.cleanupExpiredScreenshots();
    assert.ok(guestPurgeResult.cleanedCount >= 1);
    const cleanedGuestProof = await PaymentProof.findById(guestProofDoc._id);
    assert.equal(cleanedGuestProof.isDeleted, true);
    assert.equal(cleanedGuestProof.data, null);

    // Fetching deleted guest screenshot returns 410 Gone even with valid guest token
    const expiredGuestFetch = await request(app)
      .get(`/api/v1/orders/${guestOrderId}/payment-proof?token=${guestToken}`);
    assert.equal(expiredGuestFetch.status, 410);

    // e) Additional Upload Failure Edge Cases & WebP Format:
    // e.1) Non-existent order ID returns 404 Not Found
    const nonExistentOrderId = new mongoose.Types.ObjectId();
    const notFoundUpload = await request(app)
      .post(`/api/v1/orders/${nonExistentOrderId}/mark-paid`)
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        screenshot: VALID_BASE64_PNG,
        amount: 200,
        mimeType: "image/png",
      });
    assert.equal(notFoundUpload.status, 404);

    // e.2) Pay on Delivery (PAY_ON_DELIVERY) order rejects UPI screenshot upload with 409 Conflict
    const codCartId = `cart_cod_${suffix}`;
    await request(app)
      .post("/api/v1/cart/items")
      .set({ "x-guest-id": codCartId })
      .send({ productId: product._id, variantId: variant500g._id, quantity: 1 });
    const codOrderRes = await request(app)
      .post("/api/v1/orders")
      .set({ "x-guest-id": codCartId })
      .send({
        orderType: "PICKUP",
        contactName: "COD Customer",
        contactPhone: "9876543210",
        contactEmail: `cod-${suffix}@test.com`,
        paymentMethod: "PAY_ON_DELIVERY",
        deliveryDate: defaultDeliveryDate,
      });
    assert.equal(codOrderRes.status, 201);
    const codOrderId = codOrderRes.body.data.order._id;
    const codUploadRes = await request(app)
      .post(`/api/v1/orders/${codOrderId}/mark-paid`)
      .send({
        screenshot: VALID_BASE64_PNG,
        amount: codOrderRes.body.data.order.total,
        mimeType: "image/png",
        token: codOrderRes.body.data.order.guestTrackingToken,
      });
    assert.equal(codUploadRes.status, 409);

    // e.3) Synthetic WebP upload succeeds with image/webp Content-Type
    const webpCartId = `cart_webp_${suffix}`;
    await request(app)
      .post("/api/v1/cart/items")
      .set({ "x-guest-id": webpCartId })
      .send({ productId: product._id, variantId: variant500g._id, quantity: 1 });
    const webpOrderRes = await request(app)
      .post("/api/v1/orders")
      .set({ "x-guest-id": webpCartId })
      .send({
        orderType: "PICKUP",
        contactName: "WebP Customer",
        contactPhone: "9876543210",
        contactEmail: `webp-${suffix}@test.com`,
        paymentMethod: "MANUAL_UPI",
        deliveryDate: defaultDeliveryDate,
      });
    assert.equal(webpOrderRes.status, 201);
    const webpOrderId = webpOrderRes.body.data.order._id;
    const webpToken = webpOrderRes.body.data.order.guestTrackingToken;

    const webpUploadRes = await request(app)
      .post(`/api/v1/orders/${webpOrderId}/mark-paid`)
      .send({
        screenshot: VALID_BASE64_WEBP,
        amount: webpOrderRes.body.data.order.total,
        mimeType: "image/webp",
        fileName: "screenshot.webp",
        token: webpToken,
      });
    assert.equal(webpUploadRes.status, 200);
    assert.equal(webpUploadRes.body.data.order.paymentProof.mimeType, "image/webp");

    const webpFetchRes = await request(app)
      .get(`/api/v1/orders/${webpOrderId}/payment-proof?token=${webpToken}`);
    assert.equal(webpFetchRes.status, 200);
    assert.equal(webpFetchRes.headers["content-type"], "image/webp");
  });

  // =========================================================================
  // 2. Delivery Date and Time Slot Selection & Feasibility
  // =========================================================================
  await t.test("Requirement 2: Delivery date & time-slot selection, capacity feasibility, and overbooking prevention", async () => {
    // Add item to cart
    await request(app)
      .post("/api/v1/cart/items")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({ productId: product._id, variantId: variant500g._id, quantity: 1 });

    // Check available delivery slots endpoint for the customer's cart
    const slotsRes = await request(app)
      .get("/api/v1/orders/delivery-slots")
      .set(auth(USER_ROLES.CUSTOMER))
      .query({ orderType: "DELIVERY" });

    assert.equal(slotsRes.status, 200);
    assert.ok(Array.isArray(slotsRes.body.data.days));
    assert.ok(slotsRes.body.data.days.length > 0);
    assert.ok(Array.isArray(slotsRes.body.data.availableSlots));
    assert.ok(slotsRes.body.data.firstAvailableSlot, "Found an available delivery slot");
    const firstSlot = slotsRes.body.data.firstAvailableSlot;
    assert.ok(firstSlot.date);
    assert.ok(firstSlot.timeSlot);
    assert.ok(typeof firstSlot.spotsRemaining === "number");

    // Place delivery order with chosen date and slot
    const orderRes = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        orderType: "DELIVERY",
        contactName: "Slot Customer",
        contactPhone: "9876543211",
        contactEmail: `slot-${suffix}@test.com`,
        deliveryAddress: {
          addressLine1: "123 Baker Street",
          city: "London",
          postalCode: "NW1 6XE",
        },
        deliveryDate: firstSlot.date,
        deliveryTimeSlot: firstSlot.timeSlot,
        paymentMethod: "COD",
      });

    assert.equal(orderRes.status, 201);
    assert.equal(orderRes.body.data.order.deliveryDate, firstSlot.date);
    assert.equal(orderRes.body.data.order.deliveryTimeSlot, firstSlot.timeSlot);

    // Invalid delivery slot format is rejected
    await request(app)
      .post("/api/v1/cart/items")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({ productId: product._id, variantId: variant500g._id, quantity: 1 });

    const invalidSlotRes = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        orderType: "DELIVERY",
        contactName: "Slot Customer",
        contactPhone: "9876543211",
        contactEmail: `slot2-${suffix}@test.com`,
        deliveryAddress: {
          addressLine1: "123 Baker Street",
          city: "London",
          postalCode: "NW1 6XE",
        },
        deliveryDate: "invalid-date",
        deliveryTimeSlot: "midnight",
        paymentMethod: "COD",
      });
    assert.equal(invalidSlotRes.status, 400);
  });

  // =========================================================================
  // 3. Keep Only UPI and Pay on Delivery (COD)
  // =========================================================================
  await t.test("Requirement 3: Only UPI and Pay on Delivery supported; Pay on Delivery confirmed without advance payment", async () => {
    // Add item to cart
    await request(app)
      .post("/api/v1/cart/items")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({ productId: product._id, variantId: variant500g._id, quantity: 1 });

    // a) Credit / debit card payment method is rejected
    const cardRes = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        orderType: "PICKUP",
        contactName: "Card Customer",
        contactPhone: "9876543212",
        paymentMethod: "CARD",
        deliveryDate: defaultDeliveryDate,
      });
    assert.equal(cardRes.status, 400);
    assert.match(cardRes.body.message, /Unsupported payment method|MANUAL_UPI.*COD/i);

    // b) Pay on Delivery (COD) order proceeds without upfront payment
    const codRes = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        orderType: "PICKUP",
        contactName: "COD Customer",
        contactPhone: "9876543212",
        contactEmail: `cod-${suffix}@test.com`,
        paymentMethod: "COD",
        deliveryDate: defaultDeliveryDate,
      });
    assert.equal(codRes.status, 201);
    const codOrder = codRes.body.data.order;
    assert.equal(codOrder.paymentMethod, "COD");
    // Confirmed for production without advance payment
    assert.equal(codOrder.status, "CONFIRMED");
    // Payment remains pending until collection
    assert.equal(codOrder.paymentStatus, "PAYMENT_PENDING");

    // c) Owner / Manager records payment collection on delivery/pickup via confirm-payment
    const collectRes = await request(app)
      .patch(`/api/v1/orders/${codOrder._id}/confirm-payment`)
      .set(auth(USER_ROLES.OWNER))
      .send({ note: "Collected cash upon delivery" });
    assert.equal(collectRes.status, 200);
    assert.equal(collectRes.body.data.order.paymentStatus, "PAYMENT_CONFIRMED");
  });

  // =========================================================================
  // 4. Remove Quality-Check Stage: Direct Transition to Packaging
  // =========================================================================
  await t.test("Requirement 4: Production transitions directly from IN_PRODUCTION to PACKAGING, bypassing QUALITY_CHECK", async () => {
    // Create production batch in IN_PRODUCTION state with ingredients verified and consumed
    const batch = await ProductionBatch.create({
      batchNumber: `BATCH-${Date.now()}-0001`,
      product: product._id,
      productVariant: variant500g._id,
      productSnapshot: {
        productName: product.name,
        variantName: variant500g.name,
        variantQuantity: variant500g.quantity,
        variantUnit: variant500g.unit,
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 2,
        yieldUnit: "piece",
        recipeBatchQuantity: 1,
        ingredients: [{ ingredient: flour._id, name: flour.name, quantity: 250, unit: "g" }],
      },
      plannedQuantity: 2,
      unit: "piece",
      status: "IN_PRODUCTION",
      verificationStatus: "VERIFIED",
      consumptionStatus: "CONSUMED",
      completionStatus: "NOT_STARTED",
      assignedWorkers: [{ worker: users.PRODUCTION_STAFF.user._id, task: "Baking" }],
      createdBy: users.OWNER.user._id,
      startedAt: new Date(),
    });

    // Complete production -> directly moves to PACKAGING (not QUALITY_CHECK)
    const completeRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/complete`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ producedQuantity: 2, usableQuantity: 2, wastageQuantity: 0 });

    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.data.batch.status, "PACKAGING");

    // Legacy batch handling: batches in QUALITY_CHECK can be packaged directly
    await ProductionBatch.updateOne(
      { _id: batch._id },
      { $set: { status: "QUALITY_CHECK", packagingStatus: "NOT_STARTED" } }
    );
    const packagingRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/package`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ packagedQuantity: 2 });

    assert.equal(packagingRes.status, 200);
    assert.equal(packagingRes.body.data.batch.status, "PACKAGED");
  });

  // =========================================================================
  // 5. Shift Removal: Active production does not depend on shift concepts
  // =========================================================================
  await t.test("Requirement 5: Active production workflow does not require shifts or shift timings", async () => {
    // Worker batches query succeeds without shift parameter
    const workerBatches = await request(app)
      .get("/api/v1/workers/me/batches")
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(workerBatches.status, 200);
  });

  // =========================================================================
  // 6. Owner-Controlled Selling Prices & Automatic Margins
  // =========================================================================
  await t.test("Requirement 6: Owner-controlled selling price, gross profit, and gross margin calculations", async () => {
    // Customer and Staff cannot update variant price
    const forbiddenRes = await request(app)
      .patch(`/api/v1/products/${product._id}/variants/${variant500g._id}`)
      .set(auth(USER_ROLES.CUSTOMER))
      .send({ price: 250 });
    assert.equal(forbiddenRes.status, 403);

    // Owner updates variant price
    const updateRes = await request(app)
      .patch(`/api/v1/products/${product._id}/variants/${variant500g._id}`)
      .set(auth(USER_ROLES.OWNER))
      .send({ price: 250 });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.variant.price, 250);

    // Verify profitability calculation via recipeCostingService
    // Flour cost: 250g * 0.05 = Rs 12.50
    // Labour cost: 60 mins * 2.5 = Rs 150.00
    // Power cost: 40 mins * 1.0 = Rs 40.00
    // Packaging cost: 2 units * 5.0 = Rs 10.00
    // Total batch cost = 12.50 + 150 + 40 + 10 = Rs 212.50
    // Yield = 2 units -> Unit Cost = Rs 106.25
    // Selling price = Rs 250
    // Gross Profit = 250 - 106.25 = Rs 143.75
    // Gross Margin % = (250 - 106.25) / 250 * 100 = 57.50%
    // Markup % = (250 - 106.25) / 106.25 * 100 = 135.29%
    const costing = await recipeCostingService.calculateRecipeCosting(recipe, 250);
    assert.equal(costing.costs.ingredientCost, 12.5);
    assert.equal(costing.costs.labourCost, 150);
    assert.equal(costing.costs.powerCost, 40);
    assert.equal(costing.costs.packagingCost, 10);
    assert.equal(costing.costs.totalBatchCost, 212.5);
    assert.equal(costing.costs.unitCost, 106.25);
    assert.equal(costing.costs.materialOnlyUnitCost, 6.25);
    assert.equal(costing.profitability.sellingPrice, 250);
    assert.equal(costing.profitability.grossProfit, 143.75);
    assert.equal(costing.profitability.grossMarginPercentage, 57.5);
    assert.equal(costing.profitability.markupPercentage, 135.29);

    // Safe handling of zero selling price
    const zeroPriceCosting = await recipeCostingService.calculateRecipeCosting(recipe, 0);
    assert.equal(zeroPriceCosting.profitability.sellingPrice, 0);
    assert.equal(zeroPriceCosting.profitability.grossProfit, -106.25);
    assert.equal(zeroPriceCosting.profitability.grossMarginPercentage, 0);
  });

  // =========================================================================
  // 7. Full Labour, Power, and Packaging Recipe Costing
  // =========================================================================
  await t.test("Requirement 7: Comprehensive recipe costing distinguishes material-only from fully loaded costs", async () => {
    const costing = await recipeCostingService.calculateRecipeCosting(recipe, 300);

    // Verify all breakdown components exist
    assert.ok(costing.rates.labourCostPerMinute === 2.5);
    assert.ok(costing.rates.powerCostPerMinute === 1.0);
    assert.ok(costing.rates.packagingCostPerUnit === 5.0);
    assert.ok(costing.costs.materialOnlyUnitCost === 6.25); // 12.5 / 2
    assert.ok(costing.costs.unitCost === 106.25); // 212.5 / 2
    assert.ok(costing.profitability.materialGrossProfit === 293.75); // 300 - 6.25
    assert.ok(costing.profitability.grossProfit === 193.75); // 300 - 106.25
    assert.ok(costing.ingredientBreakdown.length === 1);
    assert.equal(costing.ingredientBreakdown[0].cost, 12.5);
  });

  // =========================================================================
  // 8. Concurrency-Safe Delivery Slot Reservation (Defect Resolution)
  // =========================================================================
  await t.test("Requirement 8: Concurrency-safe delivery slot reservation prevents overbooking under simultaneous checkouts", async () => {
    const targetDateObj = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const targetDate = targetDateObj.toISOString().slice(0, 10);
    const targetSlot = "09:00 - 12:00";
    const slotId = deliverySlotService.getSlotId(targetDate, targetSlot, "DELIVERY");

    // Clear prior test artifacts for this slot and isolate capacity settings
    await Setting.deleteMany({ key: "PRODUCTION_CAPACITY" });
    await Setting.deleteMany({ key: "PRODUCTION_CAPACITY" });
    await DeliverySlotReservation.deleteMany({ _id: slotId });
    await Order.deleteMany({ deliveryDate: targetDate, deliveryTimeSlot: targetSlot });

    // Pre-create 4 orders to occupy 4 spots (max capacity is 5, leaving exactly 1 spot)
    for (let i = 1; i <= 4; i++) {
      await Order.create({
        orderNumber: `ORD-PRE-${suffix}-${i}`,
        customer: users.CUSTOMER.user._id,
        items: [{
          productId: product._id,
          variantId: variant500g._id,
          productName: product.name,
          variantName: variant500g.name,
          quantity: 1,
          unitPrice: 200,
          lineTotal: 200,
        }],
        subtotal: 200,
        total: 200,
        orderType: "DELIVERY",
        deliveryDate: targetDate,
        deliveryTimeSlot: targetSlot,
        paymentMethod: "COD",
        paymentStatus: "PAYMENT_PENDING",
        contactName: `Pre-fill Customer ${i}`,
        contactPhone: `98765432${i}0`,
        status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
      });
    }

    // Baseline capacity sync
    await deliverySlotService.syncSlotCapacity(targetDate, targetSlot, "DELIVERY", 5);

    // Verify exactly 1 spot remains
    const avail = await deliverySlotService.getAvailableSlots({
      items: [{ productId: product._id, variantId: variant500g._id, quantity: 1 }],
      orderType: "DELIVERY",
    });
    const foundSlot = avail.availableSlots.find((s) => s.date === targetDate && s.timeSlot === targetSlot);
    assert.ok(foundSlot, "Target slot is found in available slots");
    assert.equal(foundSlot.spotsRemaining, 1, "Exactly 1 spot remains before concurrent checkouts");

    // Launch TWO concurrent checkout requests simultaneously for the last spot
    const guestId1 = `concurrent-guest-1-${suffix}`;
    const guestId2 = `concurrent-guest-2-${suffix}`;

    const checkout1 = request(app)
      .post("/api/v1/orders")
      .send({
        orderType: "DELIVERY",
        guestId: guestId1,
        contactName: "Concurrent Customer 1",
        contactPhone: "9876543101",
        contactEmail: `concurrent1-${suffix}@test.com`,
        items: [{ productId: product._id, variantId: variant500g._id, quantity: 1 }],
        deliveryAddress: {
          addressLine1: "101 Baker Street",
          city: "London",
          postalCode: "NW1 101",
        },
        deliveryDate: targetDate,
        deliveryTimeSlot: targetSlot,
        paymentMethod: "COD",
      });

    const checkout2 = request(app)
      .post("/api/v1/orders")
      .send({
        orderType: "DELIVERY",
        guestId: guestId2,
        contactName: "Concurrent Customer 2",
        contactPhone: "9876543102",
        contactEmail: `concurrent2-${suffix}@test.com`,
        items: [{ productId: product._id, variantId: variant500g._id, quantity: 1 }],
        deliveryAddress: {
          addressLine1: "102 Baker Street",
          city: "London",
          postalCode: "NW1 102",
        },
        deliveryDate: targetDate,
        deliveryTimeSlot: targetSlot,
        paymentMethod: "COD",
      });

    const [res1, res2] = await Promise.all([checkout1, checkout2]);

    const statuses = [res1.status, res2.status];
    assert.equal(
      statuses.filter((s) => s === 201).length,
      1,
      "Exactly one of the concurrent checkouts must succeed with 201"
    );
    assert.equal(
      statuses.filter((s) => s === 409).length,
      1,
      "The other concurrent checkout must fail with 409 Conflict"
    );

    // Verify 409 Conflict provides alternative slots
    const conflictRes = res1.status === 409 ? res1 : res2;
    assert.ok(conflictRes.body.message.includes("fully booked"));
    assert.ok(
      Array.isArray(conflictRes.body.errors) ||
      Array.isArray(conflictRes.body.errors?.alternatives) ||
      Array.isArray(conflictRes.body.data?.alternatives) ||
      Array.isArray(conflictRes.body.alternatives)
    );

    // Database assertions: Slot must never exceed max capacity (5)
    const slotDoc = await DeliverySlotReservation.findById(slotId);
    assert.equal(slotDoc.reservedCount, 5, "Slot reservedCount is exactly 5 (never overbooked)");

    const totalOrdersInDb = await Order.countDocuments({
      deliveryDate: targetDate,
      deliveryTimeSlot: targetSlot,
      status: { $in: ["PENDING_PAYMENT", "CONFIRMED", "IN_PRODUCTION", "READY", "OUT_FOR_DELIVERY"] },
    });
    assert.equal(totalOrdersInDb, 5, "Database has exactly 5 active orders (never 6)");
  });

  // =========================================================================
  // 9. Delivery Slot Reservation Release, Retries, and Idempotency
  // =========================================================================
  await t.test("Requirement 9: Delivery slot reservation release on cancellation, retry re-acquisition, and idempotency", async () => {
    const targetDateObj = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const targetDate = targetDateObj.toISOString().slice(0, 10);
    const targetSlot = "09:00 - 12:00";
    const slotId = deliverySlotService.getSlotId(targetDate, targetSlot, "DELIVERY");

    await Setting.deleteMany({ key: "PRODUCTION_CAPACITY" });
    await DeliverySlotReservation.deleteMany({ _id: slotId });
    await Order.deleteMany({ deliveryDate: targetDate, deliveryTimeSlot: targetSlot });

    // Place an order that books the slot
    const orderRes = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        orderType: "DELIVERY",
        contactName: "Release Test Customer",
        contactPhone: "9876543999",
        contactEmail: `release-${suffix}@test.com`,
        items: [{ productId: product._id, variantId: variant500g._id, quantity: 1 }],
        deliveryAddress: {
          addressLine1: "200 Baker Street",
          city: "London",
          postalCode: "NW1 200",
        },
        deliveryDate: targetDate,
        deliveryTimeSlot: targetSlot,
        paymentMethod: "COD",
      });

    assert.equal(orderRes.status, 201);
    const orderId = orderRes.body.data.order._id;

    let slotDoc = await DeliverySlotReservation.findById(slotId);
    assert.equal(slotDoc.reservedCount, 1);

    // Cancel the order -> releases slot reservation
    const cancelRes = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set(auth(USER_ROLES.CUSTOMER))
      .send({ reason: "Customer requested cancellation" });

    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.data.order.status, "CANCELLED");

    slotDoc = await DeliverySlotReservation.findById(slotId);
    assert.equal(slotDoc.reservedCount, 0, "reservedCount decremented to 0 on order cancellation");

    // Releasing a second time must not double-decrement
    await deliverySlotService.releaseSlotReservation({
      date: targetDate,
      timeSlot: targetSlot,
      orderType: "DELIVERY",
      orderId,
    });
    slotDoc = await DeliverySlotReservation.findById(slotId);
    assert.equal(slotDoc.reservedCount, 0, "Duplicate release does not underflow or double-decrement");

    // Retry booking the released slot -> succeeds
    const retryRes = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        orderType: "DELIVERY",
        contactName: "Retry Customer",
        contactPhone: "9876543998",
        contactEmail: `retry-${suffix}@test.com`,
        items: [{ productId: product._id, variantId: variant500g._id, quantity: 1 }],
        deliveryAddress: {
          addressLine1: "201 Baker Street",
          city: "London",
          postalCode: "NW1 201",
        },
        deliveryDate: targetDate,
        deliveryTimeSlot: targetSlot,
        paymentMethod: "COD",
      });

    assert.equal(retryRes.status, 201, "Successfully re-acquired the released slot");
    slotDoc = await DeliverySlotReservation.findById(slotId);
    assert.equal(slotDoc.reservedCount, 1);

    // Duplicate request with idempotencyKey -> returns original order without extra reservation
    const idempKey = `idemp-slot-${suffix}`;
    const idempRes1 = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .set("Idempotency-Key", idempKey)
      .send({
        orderType: "DELIVERY",
        contactName: "Idempotent Customer",
        contactPhone: "9876543997",
        contactEmail: `idemp-${suffix}@test.com`,
        items: [{ productId: product._id, variantId: variant500g._id, quantity: 1 }],
        deliveryAddress: {
          addressLine1: "202 Baker Street",
          city: "London",
          postalCode: "NW1 202",
        },
        deliveryDate: targetDate,
        deliveryTimeSlot: targetSlot,
        paymentMethod: "COD",
      });

    assert.equal(idempRes1.status, 201);
    const idempOrderId = idempRes1.body.data.order._id;
    slotDoc = await DeliverySlotReservation.findById(slotId);
    assert.equal(slotDoc.reservedCount, 2);

    // Resend exact same request with same idempotency key
    const idempRes2 = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .set("Idempotency-Key", idempKey)
      .send({
        orderType: "DELIVERY",
        contactName: "Idempotent Customer",
        contactPhone: "9876543997",
        contactEmail: `idemp-${suffix}@test.com`,
        items: [{ productId: product._id, variantId: variant500g._id, quantity: 1 }],
        deliveryAddress: {
          addressLine1: "202 Baker Street",
          city: "London",
          postalCode: "NW1 202",
        },
        deliveryDate: targetDate,
        deliveryTimeSlot: targetSlot,
        paymentMethod: "COD",
      });

    assert.ok([200, 201].includes(idempRes2.status));
    assert.equal(idempRes2.body.data.order._id, idempOrderId, "Idempotent request returns original order");
    slotDoc = await DeliverySlotReservation.findById(slotId);
    assert.equal(slotDoc.reservedCount, 2, "Duplicate request does not increment reservedCount again");
  });
});
