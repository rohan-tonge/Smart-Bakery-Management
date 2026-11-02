process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import Recipe from "../src/models/recipe.model.js";
import Order from "../src/models/order.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";

test("Order Overview counts: active, completed, cancelled, and stock batch separation", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create owner
  const ownerUser = await User.create({
    name: `Owner ${suffix}`,
    email: `owner-${suffix}@overview-test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER,
  });
  const ownerToken = generateAccessToken(ownerUser);
  const authHeader = { Authorization: `Bearer ${ownerToken}` };

  // Create customer
  const customerUser = await User.create({
    name: `Customer ${suffix}`,
    email: `cust-${suffix}@overview-test.com`,
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
  });

  // Create sample category & product
  const category = await Category.create({
    name: `Overview Category ${suffix}`,
    slug: `overview-cat-${suffix}`,
  });

  const product = await Product.create({
    name: `Overview Sourdough ${suffix}`,
    slug: `overview-sourdough-${suffix}`,
    category: category._id,
    variants: [
      { name: "500g", quantity: 1, unit: "piece", price: 100 },
    ],
  });
  const variantId = product.variants[0]._id;

  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    ingredients: [],
    expectedYield: 10,
    yieldUnit: "piece",
    preparationTime: 10,
    productionTime: 20,
    recipeBatchQuantity: 10,
  });

  const createdOrderIds = [];
  const createdBatchIds = [];

  t.after(async () => {
    if (createdOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: createdOrderIds } });
    }
    if (createdBatchIds.length > 0) {
      await ProductionBatch.deleteMany({ _id: { $in: createdBatchIds } });
    }
    await Recipe.deleteOne({ _id: recipe._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({
      email: { $in: [ownerUser.email, customerUser.email] },
    });
    await disconnectDb();
  });

  await t.test("1. Empty order state returns accurate zero counts in meta.counts when filtered by customer", async () => {
    const res = await request(app)
      .get(`/api/v1/orders?customer=${customerUser._id}`)
      .set(authHeader);

    assert.equal(res.status, 200);
    assert.ok(res.body.meta);
    assert.ok(res.body.meta.counts);
    assert.equal(res.body.meta.counts.total, 0);
    assert.equal(res.body.meta.counts.active, 0);
    assert.equal(res.body.meta.counts.completed, 0);
    assert.equal(res.body.meta.counts.cancelled, 0);
  });

  await t.test("2. Planned stock-production batches do NOT inflate customer order counts", async () => {
    // Create planned stock production batches with no customer orders
    const stockBatch1 = await ProductionBatch.create({
      batchNumber: `BATCH-STOCK-1-${suffix}`,
      product: product._id,
      productVariant: variantId,
      productSnapshot: { productName: product.name, variantName: "500g", variantQuantity: 1, variantUnit: "piece" },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 10,
        yieldUnit: "piece",
        recipeBatchQuantity: 10,
        ingredients: [],
      },
      createdBy: ownerUser._id,
      batchType: "PLANNED_PRODUCTION",
      plannedQuantity: 10,
      unit: "piece",
      status: "PLANNED",
      relatedOrders: [],
    });
    createdBatchIds.push(stockBatch1._id);

    const stockBatch2 = await ProductionBatch.create({
      batchNumber: `BATCH-STOCK-2-${suffix}`,
      product: product._id,
      productVariant: variantId,
      productSnapshot: { productName: product.name, variantName: "500g", variantQuantity: 1, variantUnit: "piece" },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 10,
        yieldUnit: "piece",
        recipeBatchQuantity: 10,
        ingredients: [],
      },
      createdBy: ownerUser._id,
      batchType: "PLANNED_PRODUCTION",
      plannedQuantity: 10,
      completedQuantity: 10,
      unit: "piece",
      status: "COMPLETED",
      relatedOrders: [],
    });
    createdBatchIds.push(stockBatch2._id);

    // Initial check before creating orders: customer order counts must not include stock batches
    const ordersRes = await request(app)
      .get(`/api/v1/orders?customer=${customerUser._id}`)
      .set(authHeader);

    assert.equal(ordersRes.status, 200);
    assert.equal(ordersRes.body.meta.counts.total, 0);
    assert.equal(ordersRes.body.meta.counts.active, 0);

    // Verify stock batches do not appear in order list
    const orderList = ordersRes.body.data.orders;
    const batchNumbers = [stockBatch1.batchNumber, stockBatch2.batchNumber];
    assert.ok(!orderList.some(o => batchNumbers.includes(o.orderNumber)));
  });

  await t.test("3. Accurate active, completed, cancelled, and pendingVerification counts across statuses", async () => {
    // Order 1: Active (CONFIRMED)
    const orderActive = await Order.create({
      orderNumber: `ORD-ACT-${suffix}`,
      orderType: "PICKUP",
      customer: customerUser._id,
      contactName: "Active Customer",
      contactPhone: "9876543210",
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "500g",
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
        },
      ],
      subtotal: 100,
      total: 100,
      status: "CONFIRMED",
      paymentMethod: "MANUAL_UPI",
      paymentStatus: "PAYMENT_CONFIRMED",
    });
    createdOrderIds.push(orderActive._id);

    // Order 2: Active with Pending Verification
    const orderPendingVerif = await Order.create({
      orderNumber: `ORD-PV-${suffix}`,
      orderType: "PICKUP",
      customer: customerUser._id,
      contactName: "Pending Customer",
      contactPhone: "9876543211",
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "500g",
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
        },
      ],
      subtotal: 100,
      total: 100,
      status: "PENDING_PAYMENT",
      paymentMethod: "MANUAL_UPI",
      paymentStatus: "PENDING_VERIFICATION",
    });
    createdOrderIds.push(orderPendingVerif._id);

    // Order 3: Completed (DELIVERED)
    const orderDelivered = await Order.create({
      orderNumber: `ORD-DEL-${suffix}`,
      orderType: "PICKUP",
      customer: customerUser._id,
      contactName: "Delivered Customer",
      contactPhone: "9876543212",
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "500g",
          quantity: 2,
          unitPrice: 100,
          lineTotal: 200,
        },
      ],
      subtotal: 200,
      total: 200,
      status: "DELIVERED",
      paymentMethod: "MANUAL_UPI",
      paymentStatus: "PAYMENT_CONFIRMED",
    });
    createdOrderIds.push(orderDelivered._id);

    // Order 4: Cancelled (CANCELLED)
    const orderCancelled = await Order.create({
      orderNumber: `ORD-CAN-${suffix}`,
      orderType: "PICKUP",
      customer: customerUser._id,
      contactName: "Cancelled Customer",
      contactPhone: "9876543213",
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "500g",
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
        },
      ],
      subtotal: 100,
      total: 100,
      status: "CANCELLED",
      paymentMethod: "MANUAL_UPI",
      paymentStatus: "PAYMENT_REJECTED",
    });
    createdOrderIds.push(orderCancelled._id);

    const res = await request(app)
      .get(`/api/v1/orders?customer=${customerUser._id}`)
      .set(authHeader);

    assert.equal(res.status, 200);
    const counts = res.body.meta.counts;

    // Check that counts reflect all 4 orders accurately
    assert.equal(counts.total, 4);
    assert.equal(counts.active, 2); // CONFIRMED + PENDING_PAYMENT
    assert.equal(counts.pendingVerification, 1);
    assert.equal(counts.completed, 1); // DELIVERED
    assert.equal(counts.cancelled, 1); // CANCELLED
  });

  await t.test("4. Pagination limit does NOT truncate meta.counts", async () => {
    // Request only 1 order per page
    const res = await request(app)
      .get(`/api/v1/orders?customer=${customerUser._id}&limit=1`)
      .set(authHeader);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.orders.length, 1);
    assert.equal(res.body.meta.total, 4);

    // meta.counts must still reflect the unpaginated totals across all orders
    assert.equal(res.body.meta.counts.total, 4);
    assert.equal(res.body.meta.counts.active, 2);
    assert.equal(res.body.meta.counts.completed, 1);
    assert.equal(res.body.meta.counts.cancelled, 1);
  });
});
