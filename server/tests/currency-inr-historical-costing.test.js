process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import Recipe from "../src/models/recipe.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import Order from "../src/models/order.model.js";
import Payment from "../src/models/payment.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES, UNITS } from "../src/utils/constants.js";
import {
  formatINR,
  formatPaiseINR,
  paiseToRupees,
  rupeesToPaise,
  multiplyQuantityByRupees,
  sumSafePaise,
} from "../src/utils/money.utils.js";

test("INR Currency Formatting & Historical Batch Costing Suite", async (t) => {
  try {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await t.test("Unit: INR Currency Formatting & Storage Safety", () => {
    // 1. Indian Number Grouping (Lakhs & Crores)
    assert.equal(formatINR(125000), "₹1,25,000.00");
    assert.equal(formatINR(10000000), "₹1,00,00,000.00");
    assert.equal(formatINR(120), "₹120.00");
    assert.equal(formatINR(6), "₹6.00");
    assert.equal(formatINR(0), "₹0.00");
    assert.equal(formatINR(42.5), "₹42.50");

    // 2. Safe Fallbacks for null/undefined/invalid values
    assert.equal(formatINR(null), "₹0.00");
    assert.equal(formatINR(undefined), "₹0.00");
    assert.equal(formatINR(NaN), "₹0.00");
    assert.equal(formatINR(null, { fallback: "—" }), "—");

    // 3. Paise to Rupees Conversion & Formatting
    assert.equal(paiseToRupees(240000), 2400);
    assert.equal(rupeesToPaise(2400), 240000);
    assert.equal(formatPaiseINR(240000), "₹2,400.00");
    assert.equal(formatPaiseINR(12500000), "₹1,25,000.00");
    assert.equal(formatPaiseINR(0), "₹0.00");

    // 4. Exact Multiplication without rounding drift
    // 2.5 hours * ₹120.50/hr = 30125 paise (₹301.25)
    const costPaise = multiplyQuantityByRupees(2.5, 120.5);
    assert.equal(costPaise, 30125);
    assert.equal(paiseToRupees(costPaise), 301.25);
    assert.equal(formatPaiseINR(costPaise), "₹301.25");
  });

  // Setup Users: Owner, Manager, Staff, Customer
  const owner = await User.create({
    name: `Owner ${suffix}`,
    email: `owner-${suffix}@inr-test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER,
  });
  const staff = await User.create({
    name: `Baker ${suffix}`,
    email: `baker-${suffix}@inr-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    hourlyLabourRate: 150, // ₹150/hr
  });
  const staffWithoutRate = await User.create({
    name: `Legacy Worker ${suffix}`,
    email: `legacy-${suffix}@inr-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    hourlyLabourRate: null, // Older worker without profile rate
  });
  const customer = await User.create({
    name: `Customer ${suffix}`,
    email: `cust-${suffix}@inr-test.com`,
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
  });

  const ownerToken = generateAccessToken(owner);
  const staffToken = generateAccessToken(staff);
  const customerToken = generateAccessToken(customer);
  const ownerAuth = { Authorization: `Bearer ${ownerToken}` };
  const staffAuth = { Authorization: `Bearer ${staffToken}` };
  const customerAuth = { Authorization: `Bearer ${customerToken}` };

  // Setup Catalog & Inventory
  const category = await Category.create({
    name: `INR Test Cat ${suffix}`,
    slug: `inr-cat-${suffix}`,
  });
  const product = await Product.create({
    name: `INR Truffle Cake ${suffix}`,
    slug: `inr-truffle-${suffix}`,
    category: category._id,
    basePrice: 500,
    preparationTime: 20,
    productionTime: 40,
    variants: [
      {
        name: "Standard 1kg",
        price: 650,
        quantity: 1,
        unit: UNITS.PIECE,
        isActive: true,
        isAvailable: true,
      },
    ],
  });
  const variant = product.variants[0];

  const flour = await Ingredient.create({
    name: `Flour ${suffix}`,
    slug: `flour-${suffix}`,
    unit: UNITS.KILOGRAM,
    currentStock: 100,
  });
  const chocolate = await Ingredient.create({
    name: `Cocoa ${suffix}`,
    slug: `cocoa-${suffix}`,
    unit: UNITS.KILOGRAM,
    currentStock: 50,
  });

  const flourLot = await InventoryLot.create({
    ingredient: flour._id,
    lotNumber: `LOT-FLOUR-${suffix}`,
    originalQuantity: 50,
    remainingQuantity: 50,
    unit: UNITS.KILOGRAM,
    purchaseDate: new Date(),
    unitCost: 40, // ₹40/kg
  });
  const cocoaLot = await InventoryLot.create({
    ingredient: chocolate._id,
    lotNumber: `LOT-COCOA-${suffix}`,
    originalQuantity: 20,
    remainingQuantity: 20,
    unit: UNITS.KILOGRAM,
    purchaseDate: new Date(),
    unitCost: 350, // ₹350/kg
  });

  const recipe = await Recipe.create({
    product: product._id,
    variant: variant._id,
    revision: 1,
    expectedYield: 5,
    yieldUnit: UNITS.PIECE,
    batchQuantity: 5,
    ingredients: [
      { ingredient: flour._id, quantity: 2, unit: UNITS.KILOGRAM },
      { ingredient: chocolate._id, quantity: 1, unit: UNITS.KILOGRAM },
    ],
  });

  let historicalBatchId;

  await t.test("Create older production batch with incomplete costing data", async () => {
    // Simulating an older historical batch:
    // - status: COMPLETED
    // - costing.status: NOT_FINALIZED
    // - assignedWorkers[0]: hourlyRateSnapshot is null, actualHours is null
    // - consumedIngredients: has lot records with unitCostSnapshot
    const batch = await ProductionBatch.create({
      batchNumber: `BATCH-HIST-${suffix}`,
      product: product._id,
      productVariant: variant._id,
      productSnapshot: {
        productName: product.name,
        variantName: variant.name,
        variantQuantity: 1,
        variantUnit: UNITS.PIECE,
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 5,
        yieldUnit: UNITS.PIECE,
        recipeBatchQuantity: 5,
        ingredients: [
          { ingredient: flour._id, name: flour.name, quantity: 2, unit: UNITS.KILOGRAM },
          { ingredient: chocolate._id, name: chocolate.name, quantity: 1, unit: UNITS.KILOGRAM },
        ],
      },
      plannedQuantity: 5,
      producedQuantity: 5,
      usableQuantity: 5,
      wastageQuantity: 0,
      unit: UNITS.PIECE,
      status: "COMPLETED",
      assignedWorkers: [
        {
          worker: staffWithoutRate._id,
          task: "Master Baker",
          taskStatus: "COMPLETED",
          hourlyRateSnapshot: null, // MISSING
          actualHours: null, // MISSING
        },
      ],
      consumedIngredients: [
        {
          ingredient: flour._id,
          ingredientName: flour.name,
          lot: flourLot._id,
          lotNumber: flourLot.lotNumber,
          quantity: 2,
          unit: UNITS.KILOGRAM,
          unitCostSnapshot: 40,
        },
        {
          ingredient: chocolate._id,
          ingredientName: chocolate.name,
          lot: cocoaLot._id,
          lotNumber: cocoaLot.lotNumber,
          quantity: 1,
          unit: UNITS.KILOGRAM,
          unitCostSnapshot: 350,
        },
      ],
      costing: {
        status: "NOT_FINALIZED",
      },
      createdBy: owner._id,
    });

    historicalBatchId = batch._id.toString();
    assert.ok(historicalBatchId);
  });

  await t.test("Owner inspects historical batch cost & API reports missing fields", async () => {
    const res = await request(app)
      .get(`/api/v1/production/batches/${historicalBatchId}/cost`)
      .set(ownerAuth);

    assert.equal(res.status, 200);
    const data = res.body.data?.cost || res.body.data;
    assert.equal(data.status, "INCOMPLETE");
    assert.ok(Array.isArray(data.incomplete));
    assert.ok(data.incomplete.length >= 2);
    // Verifies missing hours & missing hourly rate snapshot are flagged
    assert.ok(data.incomplete.some((msg) => msg.includes("actual hours")));
    assert.ok(data.incomplete.some((msg) => msg.includes("hourly rate snapshot")));

    // Verified lot snapshots are present
    assert.equal(data.materialSnapshots.length, 2);
    // Material cost = (2 * 40) + (1 * 350) = 80 + 350 = ₹430.00
    assert.equal(data.ingredientCost, 430);

    // Non-owners cannot access cost review API
    const staffRes = await request(app)
      .get(`/api/v1/production/batches/${historicalBatchId}/cost`)
      .set(staffAuth);
    assert.equal(staffRes.status, 403);
  });

  await t.test("Cannot finalize incomplete historical batch", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${historicalBatchId}/cost/finalize`)
      .set(ownerAuth)
      .send({ packagingCost: 20 });

    assert.equal(res.status, 409);
    assert.ok(res.body.message.includes("Cannot finalize production cost"));
  });

  await t.test("Owner completes missing historical labour rate and hours", async () => {
    // Owner provides the historical worker rate (e.g. ₹125/hr) and actual hours (3.5 hrs)
    const updateRes = await request(app)
      .patch(`/api/v1/production/batches/${historicalBatchId}/assignment`)
      .set(ownerAuth)
      .send({
        workerId: staffWithoutRate._id.toString(),
        hourlyRateSnapshot: 125,
        actualHours: 3.5,
      });

    assert.equal(updateRes.status, 200);

    // Re-inspect cost review endpoint
    const costRes = await request(app)
      .get(`/api/v1/production/batches/${historicalBatchId}/cost`)
      .set(ownerAuth);

    assert.equal(costRes.status, 200);
    const costData = costRes.body.data?.cost || costRes.body.data;
    assert.equal(costData.status, "READY_TO_FINALIZE");
    assert.equal(costData.incomplete.length, 0);

    // Labour cost = 3.5 hrs * ₹125.00/hr = ₹437.50
    assert.equal(costData.labourCost, 437.5);
    // Material cost = ₹430.00
    assert.equal(costData.ingredientCost, 430);
  });

  await t.test("Owner finalizes batch with packaging and power/fuel expenses", async () => {
    const finalizeRes = await request(app)
      .post(`/api/v1/production/batches/${historicalBatchId}/cost/finalize`)
      .set(ownerAuth)
      .send({
        packagingCost: 45, // ₹45.00 packaging boxes & ribbons
        expenses: [
          { description: "Oven Electricity / Power", amount: 62.5 },
          { description: "Baking Gas / Fuel", amount: 25 },
        ],
      });

    assert.equal(finalizeRes.status, 200);
    const finalized = finalizeRes.body.data?.cost || finalizeRes.body.data;

    assert.equal(finalized.status, "FINALIZED");
    assert.equal(finalized.ingredientCost, 430);
    assert.equal(finalized.labourCost, 437.5);
    assert.equal(finalized.packagingCost, 45);
    // Other expenses = 62.50 + 25.00 = ₹87.50
    assert.equal(finalized.otherExpense, 87.5);

    // Total Batch Cost = 430 + 437.50 + 45 + 87.50 = ₹1,000.00
    assert.equal(finalized.totalCost, 1000);
    // Cost per usable item (5 units) = 1000 / 5 = ₹200.00
    assert.equal(finalized.costPerUsableItem, 200);

    // Storage verification in database: Paise integers
    const dbBatch = await ProductionBatch.findById(historicalBatchId);
    assert.equal(dbBatch.costing.status, "FINALIZED");
    assert.equal(dbBatch.costing.ingredientCostPaise, 43000);
    assert.equal(dbBatch.costing.labourCostPaise, 43750);
    assert.equal(dbBatch.costing.packagingCostPaise, 4500);
    assert.equal(dbBatch.costing.otherExpensePaise, 8750);
    assert.equal(dbBatch.costing.totalCostPaise, 100000);
    assert.equal(dbBatch.costing.costPerUsableItemPaise, 20000);
    assert.ok(dbBatch.costing.finalizedAt instanceof Date);
    assert.equal(String(dbBatch.costing.finalizedBy), String(owner._id));
  });

  await t.test("Finalized batch is locked against re-finalization and assignment modification", async () => {
    // Attempt re-finalization -> 409 Conflict
    const reFinalizeRes = await request(app)
      .post(`/api/v1/production/batches/${historicalBatchId}/cost/finalize`)
      .set(ownerAuth)
      .send({ packagingCost: 50 });

    assert.equal(reFinalizeRes.status, 409);
    assert.ok(reFinalizeRes.body.message.includes("already finalized"));

    // Attempt to modify hours or rate on finalized batch -> 409 Conflict
    const alterRes = await request(app)
      .patch(`/api/v1/production/batches/${historicalBatchId}/assignment`)
      .set(ownerAuth)
      .send({
        workerId: staffWithoutRate._id.toString(),
        actualHours: 10,
      });

    assert.equal(alterRes.status, 409);
    assert.ok(alterRes.body.message.includes("already finalized"));
  });

  await t.test("Finalized historical batch correctly feeds Sales & Analytics COGS", async () => {
    // Create an order for 2 units of the product
    const order = await Order.create({
      orderNumber: `ORD-HIST-${suffix}`,
      customer: customer._id,
      contactName: customer.name,
      contactPhone: "9876543210",
      items: [
        {
          productId: product._id,
          variantId: variant._id,
          productName: product.name,
          variantName: variant.name,
          quantity: 2,
          unitPrice: 650,
          lineTotal: 1300,
        },
      ],
      subtotal: 1300,
      total: 1300,
      orderType: "PICKUP",
      status: "DELIVERED",
      paymentStatus: "PAYMENT_CONFIRMED",
      paymentMethod: "MANUAL_UPI",
    });

    await Payment.create({
      order: order._id,
      customer: customer._id,
      amount: 130000, // 130000 paise = ₹1300.00
      currency: "INR",
      provider: "RAZORPAY",
      status: "CAPTURED",
      method: "upi",
    });

    const today = new Date().toISOString().slice(0, 10);
    const analyticsRes = await request(app)
      .get(`/api/v1/analytics/summary?from=${today}&to=${today}`)
      .set(ownerAuth);

    assert.equal(analyticsRes.status, 200);
    const summary = analyticsRes.body.data?.summary;
    assert.ok(summary);
    assert.ok(summary.totalOrders >= 1);
    assert.ok(summary.grossSales >= 1300);
  });

  await disconnectDb();
  } catch (err) {
    console.error("TEST FAILED WITH ERROR:", err);
    throw err;
  }
});
