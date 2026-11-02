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

test("Direct Stock Order Fulfillment API and Stock Position Indicators", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create test actors
  const users = {};
  for (const role of [USER_ROLES.CUSTOMER, USER_ROLES.OWNER, USER_ROLES.PRODUCTION_STAFF]) {
    const user = await User.create({
      name: `Stock Actor ${role}`,
      email: `${role.toLowerCase()}-${suffix}@stock-test.com`,
      password: "Password123!",
      role,
      isActive: true,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  let category;
  let product;
  let variantId;
  let stockRecord;

  t.after(async () => {
    const customerId = users[USER_ROLES.CUSTOMER].user._id;
    await Order.deleteMany({ customer: customerId });
    if (product) {
      await FinishedProductStock.deleteMany({ product: product._id });
      await Product.deleteOne({ _id: product._id });
    }
    if (category) await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@stock-test\\.com$`) });
    await disconnectDb();
  });

  category = await Category.create({ name: `Stock Cat ${suffix}`, slug: `stock-cat-${suffix}` });
  product = await Product.create({
    name: `Sourdough Boule ${suffix}`,
    slug: `sourdough-boule-${suffix}`,
    category: category._id,
    basePrice: 200,
    unit: "piece",
    isActive: true,
    isAvailable: true,
    variants: [{ name: "500g Boule", price: 200, quantity: 1, unit: "piece", isActive: true }],
  });
  variantId = product.variants[0]._id;

  // Initialize finished stock with 10 pieces on hand, 0 reserved
  stockRecord = await FinishedProductStock.create({
    product: product._id,
    variant: variantId,
    onHandQuantity: 10,
    reservedQuantity: 0,
    updatedBy: users[USER_ROLES.OWNER].user._id,
  });

  // 1. Verify Stock Position Calculation on order listing
  let order1;
  await t.test("1. Order list returns stockPosition with 'Ready from Stock' when sufficient on-hand", async () => {
    order1 = await Order.create({
      orderNumber: `ORD-STOCK1-${suffix}`,
      customer: users[USER_ROLES.CUSTOMER].user._id,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "500g Boule",
          quantity: 4,
          unitPrice: 200,
          lineTotal: 800,
        },
      ],
      subtotal: 800,
      total: 800,
      orderType: "PICKUP",
      contactPhone: "9876543210",
      status: "CONFIRMED",
      paymentStatus: "PAYMENT_CONFIRMED",
    });

    const res = await request(app)
      .get(`/api/v1/orders?search=${order1.orderNumber}`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const listed = res.body.data.orders.find((o) => o._id === order1._id.toString());
    assert.ok(listed, "Order must be returned");
    assert.ok(listed.stockPosition, "Order must include stockPosition");
    assert.equal(listed.stockPosition.status, "READY_FROM_STOCK");
    assert.equal(listed.stockPosition.badge, "Ready from Stock");
    assert.equal(listed.stockPosition.canFulfillFromStock, true);
    assert.equal(listed.stockPosition.totalRequested, 4);
    assert.equal(listed.stockPosition.totalAvailable, 4);
  });

  // 2. Fulfill Order 1 from Stock
  await t.test("2. Owner successfully fulfills order from stock without creating batches", async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${order1._id}/fulfill-from-stock`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const updated = res.body.data.order;
    assert.equal(updated.fulfillmentStatus, "FULFILLED_FROM_STOCK");
    assert.equal(updated.status, "READY", "Confirmed order transitions to READY upon stock fulfillment");
    assert.equal(updated.paymentStatus, "PAYMENT_CONFIRMED", "Payment status is preserved");

    // Check FinishedProductStock: reservedQuantity should increase from 0 to 4
    const stock = await FinishedProductStock.findById(stockRecord._id);
    assert.equal(stock.reservedQuantity, 4);
    assert.equal(stock.onHandQuantity, 10);
  });

  // 3. Prevent duplicate fulfillment
  await t.test("3. Prevents duplicate fulfillment when clicked repeatedly", async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${order1._id}/fulfill-from-stock`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 409, "Should reject duplicate fulfillment with conflict error");
  });

  // 4. Partial Stock order position
  let order2;
  await t.test("4. Order with partial stock displays 'Partial Stock Available'", async () => {
    // Current stock: onHand = 10, reserved = 4 -> free = 6
    // Order requested = 8 -> free (6) < needed (8) -> Partial stock!
    order2 = await Order.create({
      orderNumber: `ORD-STOCK2-${suffix}`,
      customer: users[USER_ROLES.CUSTOMER].user._id,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "500g Boule",
          quantity: 8,
          unitPrice: 200,
          lineTotal: 1600,
        },
      ],
      subtotal: 1600,
      total: 1600,
      orderType: "DELIVERY",
      contactPhone: "9876543210",
      status: "CONFIRMED",
      paymentStatus: "PAYMENT_CONFIRMED",
    });

    const res = await request(app)
      .get(`/api/v1/orders?search=${order2.orderNumber}`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const listed = res.body.data.orders.find((o) => o._id === order2._id.toString());
    assert.ok(listed);
    assert.equal(listed.stockPosition.status, "PARTIAL_STOCK");
    assert.equal(listed.stockPosition.badge, "Partial Stock Available");
    assert.equal(listed.stockPosition.canFulfillFromStock, false);
    assert.equal(listed.stockPosition.totalRequested, 8);
    assert.equal(listed.stockPosition.totalAvailable, 6);
    assert.equal(listed.stockPosition.remainingToProduce, 2);
  });

  // 5. Reject stock fulfillment when stock is insufficient
  await t.test("5. Rejects direct fulfillment if stock is insufficient", async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${order2._id}/fulfill-from-stock`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 409, "Should reject fulfillment when insufficient free stock");
    assert.match(res.body.message, /Insufficient finished stock/);
  });

  // 6. Production Required when 0 stock free
  let order3;
  await t.test("6. Order displays 'Production Required' when 0 stock is available", async () => {
    // Reserve the remaining 6 pieces
    await FinishedProductStock.findByIdAndUpdate(stockRecord._id, { reservedQuantity: 10 });

    order3 = await Order.create({
      orderNumber: `ORD-STOCK3-${suffix}`,
      customer: users[USER_ROLES.CUSTOMER].user._id,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "500g Boule",
          quantity: 2,
          unitPrice: 200,
          lineTotal: 400,
        },
      ],
      subtotal: 400,
      total: 400,
      orderType: "PICKUP",
      contactPhone: "9876543210",
      status: "CONFIRMED",
      paymentStatus: "PAYMENT_CONFIRMED",
    });

    const res = await request(app)
      .get(`/api/v1/orders?search=${order3.orderNumber}`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const listed = res.body.data.orders.find((o) => o._id === order3._id.toString());
    assert.ok(listed);
    assert.equal(listed.stockPosition.status, "PRODUCTION_REQUIRED");
    assert.equal(listed.stockPosition.badge, "Production Required");
    assert.equal(listed.stockPosition.canFulfillFromStock, false);
  });

  // 7. Ineligible orders (Cancelled) cannot be fulfilled
  await t.test("7. Rejects fulfilling cancelled orders", async () => {
    await Order.findByIdAndUpdate(order3._id, { status: "CANCELLED" });
    const res = await request(app)
      .post(`/api/v1/orders/${order3._id}/fulfill-from-stock`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 400, "Should reject fulfilling cancelled orders");
  });
});
