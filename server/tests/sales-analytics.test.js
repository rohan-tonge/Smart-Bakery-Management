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
import Payment from "../src/models/payment.model.js";
import Recipe from "../src/models/recipe.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";

test("Sales and Profit Analytics Feature: calculations, authorization, COGS, CSV export, and edge cases", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const users = {};
  for (const role of [
    USER_ROLES.CUSTOMER,
    USER_ROLES.OWNER,
    USER_ROLES.MANAGER,
    USER_ROLES.OWNER_MANAGER,
    USER_ROLES.PRODUCTION_STAFF,
  ]) {
    const user = await User.create({
      name: `Analytics ${role}`,
      email: `${role.toLowerCase()}-${suffix}@analytics-test.com`,
      password: "Password123!",
      role,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }

  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  let category;
  let productA;
  let productB;
  let productDeleted;
  let batchA;

  const createdOrderIds = [];
  const createdPaymentIds = [];

  t.after(async () => {
    if (createdOrderIds.length) {
      await Order.deleteMany({ _id: { $in: createdOrderIds } });
    }
    if (createdPaymentIds.length) {
      await Payment.deleteMany({ _id: { $in: createdPaymentIds } });
    }
    if (batchA) {
      await ProductionBatch.deleteOne({ _id: batchA._id });
    }
    if (productA) {
      await Product.deleteOne({ _id: productA._id });
    }
    if (productB) {
      await Product.deleteOne({ _id: productB._id });
    }
    if (category) {
      await Category.deleteOne({ _id: category._id });
    }
    await User.deleteMany({ email: new RegExp(`${suffix}\\@analytics-test\\.com$`) });
    await disconnectDb();
  });

  // Base Data Fixtures
  category = await Category.create({
    name: `Analytics Bakery ${suffix}`,
    slug: `analytics-bakery-${suffix}`,
  });

  // Product A: 100 per unit, will have a finalized batch with unit cost 40
  productA = await Product.create({
    name: `Artisan Sourdough ${suffix}`,
    slug: `sourdough-${suffix}`,
    category: category._id,
    isActive: true,
    isAvailable: true,
    variants: [
      {
        name: "500g Loaf",
        quantity: 1,
        unit: "piece",
        price: 100,
        isActive: true,
        isAvailable: true,
      },
    ],
  });
  const variantAId = productA.variants[0]._id;

  // Product B: 150 per unit, will have NO finalized batch (COGS unavailable)
  productB = await Product.create({
    name: `Chocolate Croissant ${suffix}`,
    slug: `croissant-${suffix}`,
    category: category._id,
    isActive: true,
    isAvailable: true,
    variants: [
      {
        name: "Single",
        quantity: 1,
        unit: "piece",
        price: 150,
        isActive: true,
        isAvailable: true,
      },
    ],
  });
  const variantBId = productB.variants[0]._id;

  // Product Deleted: Will be created, order placed, then product document deleted
  productDeleted = await Product.create({
    name: `=SUM(A1:B1) Baguette ${suffix}`,
    slug: `baguette-${suffix}`,
    category: category._id,
    isActive: true,
    isAvailable: true,
    variants: [
      {
        name: "Standard",
        quantity: 1,
        unit: "piece",
        price: 80,
        isActive: true,
        isAvailable: true,
      },
    ],
  });
  const variantDeletedId = productDeleted.variants[0]._id;

  // Finalized production batch for Product A: 10 units produced, total cost 40000 paise (400 Rs) => 40 Rs per unit
  batchA = await ProductionBatch.create({
    batchNumber: `BATCH-A-${suffix}`,
    product: productA._id,
    productVariant: variantAId,
    productSnapshot: {
      productName: productA.name,
      variantName: "500g Loaf",
      variantQuantity: 1,
      variantUnit: "piece",
    },
    recipe: new Recipe()._id,
    recipeRevision: 1,
    recipeSnapshot: {
      expectedYield: 10,
      yieldUnit: "piece",
      recipeBatchQuantity: 1,
      ingredients: [],
    },
    plannedQuantity: 10,
    producedQuantity: 10,
    usableQuantity: 10,
    wastageQuantity: 0,
    unit: "piece",
    createdBy: users[USER_ROLES.OWNER].user._id,
    status: "COMPLETED",
    actualCompletionTime: new Date("2026-06-01T10:00:00.000Z"),
    costing: {
      status: "FINALIZED",
      totalCostPaise: 40000,
      costPerUsableItemPaise: 4000,
      costPerUsableItemStatus: "COMPUTABLE",
      finalizedAt: new Date("2026-06-01T11:00:00.000Z"),
      finalizedBy: users[USER_ROLES.OWNER].user._id,
    },
  });

  // Base test date anchors: 2026-06-15
  const testDate = new Date("2026-06-15T12:00:00.000Z");

  // Order 1: Verified Manual UPI Order (Paid)
  // 2 units Product A (2 * 100 = 200), discount 20 => gross 200, net 180
  const order1 = await Order.create({
    orderNumber: `ORD-1-${suffix}`,
    customer: users[USER_ROLES.CUSTOMER].user._id,
    items: [
      {
        productId: productA._id,
        variantId: variantAId,
        productName: productA.name,
        variantName: "500g Loaf",
        quantity: 2,
        unitPrice: 100,
        lineTotal: 200,
      },
    ],
    subtotal: 200,
    discount: 20,
    tax: 0,
    deliveryFee: 0,
    total: 180,
    orderType: "PICKUP",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PAYMENT_CONFIRMED",
    status: "CONFIRMED",
    contactPhone: "9876543210",
    createdAt: testDate,
    updatedAt: testDate,
  });
  createdOrderIds.push(order1._id);

  // Order 2: Captured Razorpay Order (Paid)
  // 1 unit Product A (100) + 1 unit Product B (150) = 250 gross, 0 discount => net 250
  const order2 = await Order.create({
    orderNumber: `ORD-2-${suffix}`,
    customer: users[USER_ROLES.CUSTOMER].user._id,
    items: [
      {
        productId: productA._id,
        variantId: variantAId,
        productName: productA.name,
        variantName: "500g Loaf",
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
      },
      {
        productId: productB._id,
        variantId: variantBId,
        productName: productB.name,
        variantName: "Single",
        quantity: 1,
        unitPrice: 150,
        lineTotal: 150,
      },
    ],
    subtotal: 250,
    discount: 0,
    tax: 0,
    deliveryFee: 0,
    total: 250,
    orderType: "PICKUP",
    paymentMethod: "RAZORPAY",
    paymentStatus: "SUCCESS",
    paymentSummary: {
      status: "CAPTURED",
      provider: "RAZORPAY",
      providerOrderId: `rzp_order_2_${suffix}`,
      providerPaymentId: `rzp_pay_2_${suffix}`,
    },
    status: "CONFIRMED",
    contactPhone: "9876543210",
    createdAt: testDate,
    updatedAt: testDate,
  });
  createdOrderIds.push(order2._id);

  const payment2 = await Payment.create({
    order: order2._id,
    customer: users[USER_ROLES.CUSTOMER].user._id,
    provider: "RAZORPAY",
    providerOrderId: `rzp_order_2_${suffix}`,
    providerPaymentId: `rzp_pay_2_${suffix}`,
    amount: 25000,
    currency: "INR",
    status: "CAPTURED",
    capturedAt: testDate,
  });
  createdPaymentIds.push(payment2._id);

  // Order 3: Unverified Manual UPI submission (UTR submitted, but PENDING_VERIFICATION)
  // Total: 300. MUST NOT be counted in Gross Sales or Net Sales!
  const order3 = await Order.create({
    orderNumber: `ORD-3-${suffix}`,
    customer: users[USER_ROLES.CUSTOMER].user._id,
    items: [
      {
        productId: productA._id,
        variantId: variantAId,
        productName: productA.name,
        variantName: "500g Loaf",
        quantity: 3,
        unitPrice: 100,
        lineTotal: 300,
      },
    ],
    subtotal: 300,
    discount: 0,
    total: 300,
    orderType: "PICKUP",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PENDING_VERIFICATION",
    paymentReference: `UTR${suffix.slice(0, 8).toUpperCase()}`,
    status: "PENDING_PAYMENT",
    contactPhone: "9876543210",
    createdAt: testDate,
    updatedAt: testDate,
  });
  createdOrderIds.push(order3._id);

  // Order 4: Cancelled Order (Rejected payment)
  // Total: 500. MUST NOT be in Gross Sales or Net Sales!
  const order4 = await Order.create({
    orderNumber: `ORD-4-${suffix}`,
    customer: users[USER_ROLES.CUSTOMER].user._id,
    items: [
      {
        productId: productB._id,
        variantId: variantBId,
        productName: productB.name,
        variantName: "Single",
        quantity: 2,
        unitPrice: 150,
        lineTotal: 300,
      },
    ],
    subtotal: 300,
    discount: 0,
    total: 300,
    orderType: "PICKUP",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PAYMENT_REJECTED",
    status: "CANCELLED",
    contactPhone: "9876543210",
    createdAt: testDate,
    updatedAt: testDate,
  });
  createdOrderIds.push(order4._id);

  // Order 5: Deleted product order (Paid)
  // 1 unit Product Deleted (80 Rs)
  const order5 = await Order.create({
    orderNumber: `ORD-5-${suffix}`,
    customer: users[USER_ROLES.CUSTOMER].user._id,
    items: [
      {
        productId: productDeleted._id,
        variantId: variantDeletedId,
        productName: productDeleted.name,
        variantName: "Standard",
        quantity: 1,
        unitPrice: 80,
        lineTotal: 80,
      },
    ],
    subtotal: 80,
    discount: 0,
    total: 80,
    orderType: "PICKUP",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PAYMENT_CONFIRMED",
    status: "CONFIRMED",
    contactPhone: "9876543210",
    createdAt: testDate,
    updatedAt: testDate,
  });
  createdOrderIds.push(order5._id);

  // Now delete the ProductDeleted document to verify historical preservation
  await Product.deleteOne({ _id: productDeleted._id });

  // 1. Authorization tests
  await t.test("Authorization: Enforces owner/manager access on all analytics endpoints", async () => {
    const endpoints = [
      "/api/v1/analytics/summary",
      "/api/v1/analytics/sales-over-time",
      "/api/v1/analytics/top-products",
      "/api/v1/analytics/product-performance",
      "/api/v1/analytics/export",
    ];

    for (const ep of endpoints) {
      // Unauthenticated -> 401
      const unauth = await request(app).get(ep);
      assert.equal(unauth.status, 401, `Expected 401 for unauthenticated request on ${ep}`);

      // Customer -> 403
      const cust = await request(app).get(ep).set(auth(USER_ROLES.CUSTOMER));
      assert.equal(cust.status, 403, `Expected 403 for Customer on ${ep}`);

      // Production Staff -> 403
      const staff = await request(app).get(ep).set(auth(USER_ROLES.PRODUCTION_STAFF));
      assert.equal(staff.status, 403, `Expected 403 for Production Staff on ${ep}`);

      // Owner -> 200
      const owner = await request(app).get(ep).set(auth(USER_ROLES.OWNER));
      assert.equal(owner.status, 200, `Expected 200 for Owner on ${ep}`);

      // Manager -> 200
      const mgr = await request(app).get(ep).set(auth(USER_ROLES.MANAGER));
      assert.equal(mgr.status, 200, `Expected 200 for Manager on ${ep}`);

      // Owner_Manager -> 200
      const om = await request(app).get(ep).set(auth(USER_ROLES.OWNER_MANAGER));
      assert.equal(om.status, 200, `Expected 200 for Owner_Manager on ${ep}`);
    }
  });

  // 2. Summary calculations
  await t.test("Summary: Accurately calculates orders, sales, discounts, unverified exclusions, and COGS", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/summary?from=2026-06-14&to=2026-06-16")
      .set(auth(USER_ROLES.OWNER_MANAGER));

    assert.equal(res.status, 200);
    const s = res.body.data.summary;

    // Total orders created in range: Order 1, Order 2, Order 3, Order 4, Order 5 = 5
    assert.equal(s.totalOrders, 5);

    // Paid orders: Order 1, Order 2, Order 5 = 3
    assert.equal(s.paidOrders, 3);

    // Pending orders: Order 3 = 1
    assert.equal(s.pendingOrders, 1);

    // Cancelled orders: Order 4 = 1
    assert.equal(s.cancelledOrders, 1);

    // Gross sales:
    // Order 1 (2 * 100 = 200) + Order 2 (100 + 150 = 250) + Order 5 (80) = 530
    assert.equal(s.grossSales, 530);
    assert.equal(s.grossSalesPaise, 53000);

    // Discounts: Order 1 discount = 20
    assert.equal(s.discount, 20);
    assert.equal(s.discountPaise, 2000);

    // Refunds: 0
    assert.equal(s.refund, 0);

    // Net sales: Gross (530) - Discount (20) = 510
    assert.equal(s.netSales, 510);
    assert.equal(s.netSalesPaise, 51000);

    // Pending payment value: Order 3 (total 300)
    assert.equal(s.pendingPayment, 300);
    assert.equal(s.pendingPaymentPaise, 30000);

    // COGS:
    // Paid units sold:
    // Product A: 2 (Order 1) + 1 (Order 2) = 3 units sold. Batch unit cost = 40 Rs. COGS = 3 * 40 = 120 Rs (12000 paise).
    // Product B: 1 unit sold. No finalized batches. Cost = 0.
    // Product Deleted: 1 unit sold. No batches. Cost = 0.
    // Total sold units = 5. Costed units = 3 (60%).
    assert.equal(s.cogsStatus, "PARTIAL");
    assert.equal(s.cogs, 120);
    assert.equal(s.cogsPaise, 12000);
    assert.equal(s.cogsCoveragePercent, 60);

    // Gross profit: Net Sales (510) - COGS (120) = 390 Rs
    assert.equal(s.grossProfit, 390);
    assert.equal(s.grossProfitPaise, 39000);

    // Margin: (390 / 510) * 100 = 76.47%
    assert.equal(s.grossMarginPercentage, 76.47);
  });

  // 3. Sales over time
  await t.test("Sales Over Time: Accurately groups time series and buckets orders", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/sales-over-time?from=2026-06-14&to=2026-06-16&group=day")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const { timeline } = res.body.data;
    assert.ok(Array.isArray(timeline));
    const dayEntry = timeline.find((t) => t.period === "2026-06-15");
    assert.ok(dayEntry, "Expected timeline entry for 2026-06-15");
    assert.equal(dayEntry.totalOrders, 5);
    assert.equal(dayEntry.paidOrders, 3);
    assert.equal(dayEntry.grossSales, 530);
    assert.equal(dayEntry.netSales, 510);
    assert.equal(dayEntry.pendingPayment, 300);
  });

  // 4. Top products ranking
  await t.test("Top Products: Ranks products by units sold and by revenue", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/top-products?from=2026-06-14&to=2026-06-16&limit=5")
      .set(auth(USER_ROLES.MANAGER));

    assert.equal(res.status, 200);
    const { byUnitsSold, byRevenue } = res.body.data;

    // Top by units sold: Product A sold 3 units (2 in Order 1, 1 in Order 2)
    assert.equal(byUnitsSold[0].productId, String(productA._id));
    assert.equal(byUnitsSold[0].unitsSold, 3);

    // Top by revenue: Product A has gross 300, Product B has 150, Deleted has 80
    assert.equal(byRevenue[0].productId, String(productA._id));
    assert.equal(byRevenue[0].grossSales, 300);
  });

  // 5. Product performance & historical data preservation
  await t.test("Product Performance: Preserves historical snapshots for deleted products", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/product-performance?from=2026-06-14&to=2026-06-16")
      .set(auth(USER_ROLES.OWNER_MANAGER));

    assert.equal(res.status, 200);
    const { products, meta } = res.body.data;
    assert.ok(products.length >= 3);

    // Find deleted product entry
    const deletedItem = products.find((p) => p.productId === String(productDeleted._id));
    assert.ok(deletedItem, "Deleted product should remain preserved in performance report");
    assert.equal(deletedItem.productName, productDeleted.name);
    assert.equal(deletedItem.unitsSold, 1);
    assert.equal(deletedItem.grossSales, 80);
    assert.equal(deletedItem.cogsStatus, "UNAVAILABLE");
  });

  // 6. CSV Export and formula injection safety
  await t.test("CSV Export: Escapes quotes, commas, and mitigates formula injection", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/export?from=2026-06-14&to=2026-06-16")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/csv/);
    assert.match(res.headers["content-disposition"], /attachment;\s*filename="sales-analytics-/);

    const csv = res.text;
    assert.ok(csv.includes("Smart Bakery Management - Sales & Profit Analytics Report"));
    assert.ok(csv.includes("EXECUTIVE SUMMARY"));
    assert.ok(csv.includes("PRODUCT PERFORMANCE BREAKDOWN"));

    // Formula injection check:
    // ProductDeleted name was "=SUM(A1:B1) Baguette ..."
    // In CSV, it MUST start with single-quote '=SUM(A1:B1) ...' to neutralize formula execution in Excel
    assert.ok(
      csv.includes("'=SUM(A1:B1)"),
      "Formula-starting product name must be prefixed with single quote in CSV"
    );
  });

  // 7. Date validation and boundary checks
  await t.test("Validation: Rejects invalid date formats and from > to ranges", async () => {
    // from > to
    const invalidRange = await request(app)
      .get("/api/v1/analytics/summary?from=2026-06-20&to=2026-06-10")
      .set(auth(USER_ROLES.OWNER));
    assert.equal(invalidRange.status, 400);

    // Malformed date
    const malformed = await request(app)
      .get("/api/v1/analytics/summary?from=not-a-date")
      .set(auth(USER_ROLES.OWNER));
    assert.equal(malformed.status, 400);
  });

  // 8. Empty dataset handling
  await t.test("Empty Dataset: Returns zeroed summary without errors for empty periods", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/summary?from=2040-01-01&to=2040-01-02")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const s = res.body.data.summary;
    assert.equal(s.totalOrders, 0);
    assert.equal(s.paidOrders, 0);
    assert.equal(s.grossSales, 0);
    assert.equal(s.netSales, 0);
    assert.equal(s.cogs, 0);
    assert.equal(s.cogsStatus, "COMPUTABLE");
    assert.equal(s.grossProfit, 0);
    assert.equal(s.grossMarginPercentage, 0);
    assert.equal(s.grossMarginStatus, "COMPUTABLE");
  });

  // 9. Zero-sales period with cancelled orders
  await t.test("Genuine Zero Profit: Period with only cancelled orders establishes zero profit and COMPUTABLE margin", async () => {
    const cancelledOnlyDate = new Date("2041-01-01T10:00:00.000Z");
    const cancelledOrder = await Order.create({
      orderNumber: `ORD-CANCELLED-${suffix}`,
      customer: users[USER_ROLES.CUSTOMER].user._id,
      items: [
        {
          productId: productA._id,
          variantId: variantAId,
          productName: productA.name,
          variantName: "500g Loaf",
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
        },
      ],
      subtotal: 100,
      total: 100,
      orderType: "PICKUP",
      contactPhone: "9876543210",
      status: "CANCELLED",
      paymentStatus: "PAYMENT_REJECTED",
      createdAt: cancelledOnlyDate,
    });
    createdOrderIds.push(cancelledOrder._id);

    const res = await request(app)
      .get("/api/v1/analytics/summary?from=2041-01-01&to=2041-01-01")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const s = res.body.data.summary;
    assert.equal(s.totalOrders, 1);
    assert.equal(s.paidOrders, 0);
    assert.equal(s.cancelledOrders, 1);
    assert.equal(s.netSales, 0);
    assert.equal(s.cogs, 0);
    assert.equal(s.cogsStatus, "COMPUTABLE");
    assert.equal(s.grossProfit, 0);
    assert.equal(s.grossMarginPercentage, 0);
  });

  // 10. Distinction: Paid order with uncosted products returns UNAVAILABLE / Pending Costing
  await t.test("Pending Costing: Period with paid sales of uncosted product returns UNAVAILABLE and null profit", async () => {
    const uncostedDate = new Date("2042-01-01T10:00:00.000Z");
    const uncostedOrder = await Order.create({
      orderNumber: `ORD-UNCOSTED-${suffix}`,
      customer: users[USER_ROLES.CUSTOMER].user._id,
      items: [
        {
          productId: productB._id, // Product B has no finalized production batch
          variantId: variantBId,
          productName: productB.name,
          variantName: "Single",
          quantity: 2,
          unitPrice: 150,
          lineTotal: 300,
        },
      ],
      subtotal: 300,
      total: 300,
      orderType: "PICKUP",
      contactPhone: "9876543210",
      status: "CONFIRMED",
      paymentStatus: "PAYMENT_CONFIRMED",
      paymentMethod: "MANUAL_UPI",
      createdAt: uncostedDate,
    });
    createdOrderIds.push(uncostedOrder._id);

    const res = await request(app)
      .get("/api/v1/analytics/summary?from=2042-01-01&to=2042-01-01")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const s = res.body.data.summary;
    assert.equal(s.totalOrders, 1);
    assert.equal(s.paidOrders, 1);
    assert.equal(s.netSales, 300);
    assert.equal(s.cogs, null);
    assert.equal(s.cogsStatus, "UNAVAILABLE");
    assert.equal(s.grossProfit, null);
    assert.equal(s.grossMarginPercentage, null);
    assert.equal(s.grossMarginStatus, "UNAVAILABLE");
  });
});
