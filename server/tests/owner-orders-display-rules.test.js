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
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";
import { getBakeryTomorrowString } from "../src/utils/date.utils.js";

test("Owner Orders & Payments display rules and customer search", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tomorrowStr = getBakeryTomorrowString();

  // Create owner
  const ownerUser = await User.create({
    name: `Owner ${suffix}`,
    email: `owner-${suffix}@display-rules-test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER,
  });
  const ownerToken = generateAccessToken(ownerUser);
  const authHeader = { Authorization: `Bearer ${ownerToken}` };

  // Create registered customers
  const customerA = await User.create({
    name: `Rohan Patel ${suffix}`,
    email: `rohan-${suffix}@display-rules-test.com`,
    phone: "9876543210",
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
  });

  const customerB = await User.create({
    name: `Priya Sharma ${suffix}`,
    email: `priya-${suffix}@display-rules-test.com`,
    phone: "9123456780",
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
  });

  // Create sample category & product
  const category = await Category.create({
    name: `Display Category ${suffix}`,
    slug: `display-cat-${suffix}`,
  });

  const product = await Product.create({
    name: `Sourdough Loaf ${suffix}`,
    slug: `sourdough-${suffix}`,
    category: category._id,
    isActive: true,
    isAvailable: true,
    variants: [
      { name: "500g", quantity: 500, unit: "g", price: 180, isActive: true, isAvailable: true },
      { name: "1kg", quantity: 1000, unit: "g", price: 320, isActive: true, isAvailable: true },
    ],
  });

  const createdOrderIds = [];

  t.after(async () => {
    if (createdOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: createdOrderIds } });
    }
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({
      email: { $in: [ownerUser.email, customerA.email, customerB.email] },
    });
    await disconnectDb();
  });

  // 1. Create an Active Order (CONFIRMED) for customer A
  const activeOrder = await Order.create({
    orderNumber: `ORD-ACT-${suffix}`,
    customer: customerA._id,
    contactName: "Rohan Patel",
    contactPhone: "9876543210",
    deliveryAddress: { addressLine1: "123 Baker St", city: "Mumbai", postalCode: "400001" },
    orderType: "DELIVERY",
    deliveryDate: tomorrowStr,
    deliverySlotReservation: { released: true },
    specialInstructions: "Please pack with extra insulation",
    status: "CONFIRMED",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PAYMENT_CONFIRMED",
    items: [
      {
        productId: product._id,
        variantId: product.variants[0]._id,
        productName: "Sourdough Loaf",
        variantName: "500g",
        quantity: 2,
        unitPrice: 180,
        lineTotal: 360,
      },
    ],
    subtotal: 360,
    deliveryFee: 40,
    pricing: { subtotal: 360, deliveryFee: 40, total: 400 },
    total: 400,
  });
  createdOrderIds.push(activeOrder._id);

  // 2. Create a Historical Order (DELIVERED) for customer A
  const deliveredOrder = await Order.create({
    orderNumber: `ORD-DEL-${suffix}`,
    customer: customerA._id,
    contactName: "Rohan Patel",
    contactPhone: "9876543210",
    deliveryAddress: { addressLine1: "123 Baker St", city: "Mumbai", postalCode: "400001" },
    orderType: "DELIVERY",
    deliveryDate: tomorrowStr,
    status: "DELIVERED",
    paymentMethod: "COD",
    paymentStatus: "PAYMENT_CONFIRMED",
    items: [
      {
        productId: product._id,
        variantId: product.variants[1]._id,
        productName: "Sourdough Loaf",
        variantName: "1kg",
        quantity: 1,
        unitPrice: 320,
        lineTotal: 320,
      },
    ],
    subtotal: 320,
    deliveryFee: 0,
    pricing: { subtotal: 320, deliveryFee: 0, total: 320 },
    total: 320,
  });
  createdOrderIds.push(deliveredOrder._id);

  // 3. Create a Historical Order (CANCELLED) for customer B
  const cancelledOrder = await Order.create({
    orderNumber: `ORD-CAN-${suffix}`,
    customer: customerB._id,
    contactName: "Priya Sharma",
    contactPhone: "9123456780",
    orderType: "PICKUP",
    deliveryDate: tomorrowStr,
    status: "CANCELLED",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "FAILED",
    items: [
      {
        productId: product._id,
        variantId: product.variants[0]._id,
        productName: "Sourdough Loaf",
        variantName: "500g",
        quantity: 3,
        unitPrice: 180,
        lineTotal: 540,
      },
    ],
    subtotal: 540,
    deliveryFee: 0,
    pricing: { subtotal: 540, deliveryFee: 0, total: 540 },
    total: 540,
  });
  createdOrderIds.push(cancelledOrder._id);

  // 4. Create an Out For Delivery Order to test transition to DELIVERED
  const outForDeliveryOrder = await Order.create({
    orderNumber: `ORD-OUT-${suffix}`,
    customer: customerB._id,
    contactName: "Priya Sharma",
    contactPhone: "9123456780",
    deliveryAddress: { addressLine1: "456 Marine Drive", city: "Mumbai", postalCode: "400020" },
    orderType: "DELIVERY",
    deliveryDate: tomorrowStr,
    status: "OUT_FOR_DELIVERY",
    paymentMethod: "COD",
    paymentStatus: "PAYMENT_PENDING",
    items: [
      {
        productId: product._id,
        variantId: product.variants[0]._id,
        productName: "Sourdough Loaf",
        variantName: "500g",
        quantity: 1,
        unitPrice: 180,
        lineTotal: 180,
      },
    ],
    subtotal: 180,
    deliveryFee: 0,
    pricing: { subtotal: 180, deliveryFee: 0, total: 180 },
    total: 180,
  });
  createdOrderIds.push(outForDeliveryOrder._id);

  await t.test("Active order retains full details including items, instructions, and pricing", async () => {
    const res = await request(app)
      .get(`/api/v1/orders/${activeOrder._id}`)
      .set(authHeader);

    assert.equal(res.status, 200);
    const ord = res.body.data.order || res.body.data;
    assert.equal(ord.orderNumber, activeOrder.orderNumber);
    assert.equal(ord.contactName, "Rohan Patel");
    assert.equal(ord.contactPhone, "9876543210");
    assert.equal(ord.status, "CONFIRMED");
    assert.equal(ord.total, 400);
    assert.equal(ord.specialInstructions, "Please pack with extra insulation");
    assert.equal(ord.items.length, 1);
    assert.equal(ord.items[0].productName, "Sourdough Loaf");
    assert.equal(ord.items[0].variantName, "500g");
    assert.equal(ord.items[0].quantity, 2);
    assert.equal(ord.items[0].unitPrice, 180);
  });

  await t.test("Historical orders retain customer details, status, and persisted order total", async () => {
    const delRes = await request(app)
      .get(`/api/v1/orders/${deliveredOrder._id}`)
      .set(authHeader);

    assert.equal(delRes.status, 200);
    const delOrd = delRes.body.data.order || delRes.body.data;
    assert.equal(delOrd.contactName, "Rohan Patel");
    assert.equal(delOrd.contactPhone, "9876543210");
    assert.equal(delOrd.status, "DELIVERED");
    assert.equal(delOrd.total, 320);

    const canRes = await request(app)
      .get(`/api/v1/orders/${cancelledOrder._id}`)
      .set(authHeader);

    assert.equal(canRes.status, 200);
    const canOrd = canRes.body.data.order || canRes.body.data;
    assert.equal(canOrd.contactName, "Priya Sharma");
    assert.equal(canOrd.contactPhone, "9123456780");
    assert.equal(canOrd.status, "CANCELLED");
    assert.equal(canOrd.total, 540);
  });

  await t.test("Case-insensitive partial customer search matches both active and historical orders", async () => {
    // Search for "roh" (should match Rohan Patel: active and delivered)
    const res = await request(app)
      .get("/api/v1/orders?search=roh")
      .set(authHeader);

    assert.equal(res.status, 200);
    const orders = res.body.data.orders || res.body.data;
    const matchedIds = orders.map((o) => o._id.toString());

    assert.ok(matchedIds.includes(activeOrder._id.toString()), "Should match active order for Rohan");
    assert.ok(matchedIds.includes(deliveredOrder._id.toString()), "Should match delivered order for Rohan");
    assert.ok(!matchedIds.includes(cancelledOrder._id.toString()), "Should not match cancelled order for Priya");
  });

  await t.test("Partial customer search by phone number matches orders", async () => {
    // Search for "912345" (Priya Sharma)
    const res = await request(app)
      .get("/api/v1/orders?search=912345")
      .set(authHeader);

    assert.equal(res.status, 200);
    const orders = res.body.data.orders || res.body.data;
    const matchedIds = orders.map((o) => o._id.toString());

    assert.ok(matchedIds.includes(cancelledOrder._id.toString()), "Should match Priya's order");
    assert.ok(!matchedIds.includes(activeOrder._id.toString()), "Should not match Rohan's order");
  });

  await t.test("Combining search with status filter narrows results accurately", async () => {
    // Search "roh" with status=CONFIRMED -> only activeOrder
    const resActive = await request(app)
      .get("/api/v1/orders?search=roh&status=CONFIRMED")
      .set(authHeader);

    assert.equal(resActive.status, 200);
    const activeResults = resActive.body.data.orders || resActive.body.data;
    assert.equal(activeResults.length, 1);
    assert.equal(activeResults[0]._id.toString(), activeOrder._id.toString());

    // Search "roh" with status=DELIVERED -> only deliveredOrder
    const resDelivered = await request(app)
      .get("/api/v1/orders?search=roh&status=DELIVERED")
      .set(authHeader);

    assert.equal(resDelivered.status, 200);
    const deliveredResults = resDelivered.body.data.orders || resDelivered.body.data;
    assert.equal(deliveredResults.length, 1);
    assert.equal(deliveredResults[0]._id.toString(), deliveredOrder._id.toString());
  });

  await t.test("Clearing search restores all permitted orders across statuses", async () => {
    const res = await request(app)
      .get("/api/v1/orders?limit=50")
      .set(authHeader);

    assert.equal(res.status, 200);
    const orders = res.body.data.orders || res.body.data;
    const ids = orders.map((o) => o._id.toString());

    assert.ok(ids.includes(activeOrder._id.toString()));
    assert.ok(ids.includes(deliveredOrder._id.toString()));
    assert.ok(ids.includes(cancelledOrder._id.toString()));
  });

  await t.test("Transitioning OUT_FOR_DELIVERY order to DELIVERED preserves total and updates state", async () => {
    const res = await request(app)
      .patch(`/api/v1/orders/${outForDeliveryOrder._id}/status`)
      .set(authHeader)
      .send({ status: "DELIVERED" });

    assert.equal(res.status, 200);
    const updated = res.body.data.order || res.body.data;
    assert.equal(updated.status, "DELIVERED");
    assert.equal(updated.total, 180);

    const recheck = await Order.findById(outForDeliveryOrder._id);
    assert.equal(recheck.status, "DELIVERED");
    assert.equal(recheck.total, 180);
  });

  await t.test("Transitioning CONFIRMED order to CANCELLED preserves total and updates state", async () => {
    const res = await request(app)
      .patch(`/api/v1/orders/${activeOrder._id}/status`)
      .set(authHeader)
      .send({ status: "CANCELLED" });

    assert.equal(res.status, 200);
    const updated = res.body.data.order || res.body.data;
    assert.equal(updated.status, "CANCELLED");
    assert.equal(updated.total, 400);

    const recheck = await Order.findById(activeOrder._id);
    assert.equal(recheck.status, "CANCELLED");
    assert.equal(recheck.total, 400);
  });
});
