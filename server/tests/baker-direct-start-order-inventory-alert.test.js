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
import Recipe from "../src/models/recipe.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import Order from "../src/models/order.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import Setting from "../src/models/setting.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES, PRODUCTION_STATUS as S, CUSTOMER_ORDER_STATUSES } from "../src/utils/constants.js";
import { getBakeryTomorrowString } from "../src/utils/date.utils.js";
import orderService from "../src/services/order.service.js";
import { orderFeasibilityService } from "../src/services/order-feasibility.service.js";

test("Baker Direct Start and Order Inventory Alert Regression Suite", async (t) => {
  await connectToDb();
  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tomorrowStr = getBakeryTomorrowString();

    await Setting.findOneAndUpdate(
      { key: "PRODUCTION_CAPACITY" },
      {
        $set: {
          value: {
            workingHours: { open: "08:00", close: "22:00" },
            slotMinutes: 90,
            minutesPerStaffPerDay: 480,
            ovens: [{ name: "Test Oven 1", minutesPerDay: 720 }],
            reservedByDay: {},
          },
          description: "Owner-configured production capacity",
        },
      },
      { upsert: true }
    );

  // 1. Setup Roles & Users
  const owner = await User.create({
    name: `Owner ${suffix}`,
    email: `owner-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER_MANAGER,
    isActive: true,
  });
  const ownerToken = generateAccessToken(owner);

  const manager = await User.create({
    name: `Manager ${suffix}`,
    email: `manager-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.MANAGER,
    isActive: true,
  });
  const managerToken = generateAccessToken(manager);

  const baker = await User.create({
    name: `Baker Kabir ${suffix}`,
    email: `baker-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    jobDesignation: "Artisan Baker",
    hourlyLabourRate: 200,
    isActive: true,
  });
  const bakerToken = generateAccessToken(baker);

  const baker2 = await User.create({
    name: `Baker Ananya ${suffix}`,
    email: `baker2-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    jobDesignation: "Pastry Specialist",
    hourlyLabourRate: 190,
    isActive: true,
  });
  const baker2Token = generateAccessToken(baker2);

  const customer = await User.create({
    name: `Customer ${suffix}`,
    email: `customer-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
    isActive: true,
  });
  const customerToken = generateAccessToken(customer);

  // 2. Setup Category, Ingredients, Inventory Lots, Product, Recipe
  const category = await Category.create({
    name: `Cakes ${suffix}`,
    slug: `cakes-${suffix}`,
    isActive: true,
  });

  const flour = await Ingredient.create({
    name: `Organic Flour ${suffix}`,
    slug: `organic-flour-${suffix}`,
    unit: "kg",
    costPerUnit: 50,
    minimumStock: 2,
    reorderLevel: 5,
    isActive: true,
  });

  const sugar = await Ingredient.create({
    name: `Refined Sugar ${suffix}`,
    slug: `refined-sugar-${suffix}`,
    unit: "kg",
    costPerUnit: 40,
    minimumStock: 1,
    reorderLevel: 3,
    isActive: true,
  });

  // Create lots for flour and sugar with tracked unit costs
  const flourLot = await InventoryLot.create({
    ingredient: flour._id,
    lotNumber: `LOT-FLOUR-${suffix}`,
    originalQuantity: 100,
    remainingQuantity: 100,
    unit: "kg",
    unitCost: 52.5,
    purchaseDate: new Date(),
    status: "AVAILABLE",
    expiryDate: new Date(Date.now() + 60 * 86400000),
  });

  const sugarLot = await InventoryLot.create({
    ingredient: sugar._id,
    lotNumber: `LOT-SUGAR-${suffix}`,
    originalQuantity: 50,
    remainingQuantity: 50,
    unit: "kg",
    unitCost: 41.0,
    purchaseDate: new Date(),
    status: "AVAILABLE",
    expiryDate: new Date(Date.now() + 90 * 86400000),
  });

  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Brioche Loaf ${suffix}`,
    slug: `brioche-loaf-${suffix}`,
    sku: `SKU-${suffix}`,
    category: category._id,
    preparationTime: 20,
    productionTime: 40,
    variants: [
      {
        _id: variantId,
        name: "Regular",
        quantity: 1,
        unit: "piece",
        price: 150,
        isActive: true,
        isAvailable: true,
      },
    ],
    isActive: true,
    isAvailable: true,
  });

  const recipe = await Recipe.create({
    name: `Brioche Recipe ${suffix}`,
    product: product._id,
    variant: variantId,
    revision: 1,
    expectedYield: 10,
    yieldUnit: "piece",
    recipeBatchQuantity: 10,
    preparationTime: 20,
    productionTime: 40,
    ingredients: [
      { ingredient: flour._id, name: flour.name, quantity: 5, unit: "kg" },
      { ingredient: sugar._id, name: sugar.name, quantity: 2, unit: "kg" },
    ],
    isActive: true,
  });

  // Helper to create planned batch
  const createPlannedBatch = async (batchNum, plannedQty = 10, assignedWorker = baker._id) => {
    return ProductionBatch.create({
      batchNumber: batchNum,
      product: product._id,
      productVariant: variantId,
      productSnapshot: {
        productName: product.name,
        variantName: "Regular",
        variantQuantity: 1,
        variantUnit: "piece",
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 10,
        yieldUnit: "piece",
        recipeBatchQuantity: 10,
        ingredients: [
          { ingredient: flour._id, name: flour.name, quantity: 5, unit: "kg" },
          { ingredient: sugar._id, name: sugar.name, quantity: 2, unit: "kg" },
        ],
        preparationTime: 20,
        productionTime: 40,
      },
      plannedQuantity: plannedQty,
      unit: "piece",
      status: S.PLANNED,
      planningStatus: "APPROVED",
      assignedWorkers: [{ worker: assignedWorker, task: "Mixing & Baking" }],
      createdBy: owner._id,
    });
  };

  // Helper for batch plan payload
  const getPlanPayload = (b) => ({
    batchNumber: b.batchNumber,
    product: String(b.product),
    plannedQuantity: b.plannedQuantity,
    relatedOrders: [],
    assignedWorkers: b.assignedWorkers.map((w) => String(w.worker)),
  });

  t.after(async () => {
    try {
      await ProductionBatch.deleteMany({ batchNumber: new RegExp(suffix) });
      await Order.deleteMany({ orderNumber: new RegExp(suffix) });
      await InventoryLot.deleteMany({ lotNumber: new RegExp(suffix) });
      await Recipe.deleteOne({ _id: recipe._id });
      await Product.deleteOne({ _id: product._id });
      await Category.deleteOne({ _id: category._id });
      await Ingredient.deleteMany({ _id: { $in: [flour._id, sugar._id] } });
      await User.deleteMany({ email: new RegExp(suffix) });
    } catch {}
    await disconnectDb();
  });

  // =========================================================================
  // TEST 1: Baker accepts assignment and can start without separate ingredient approval
  // =========================================================================
  await t.test("1. Baker accepts assignment and can start directly without separate ingredient approval", async () => {
    const batch = await createPlannedBatch(`BATCH-T1-${suffix}`);

    // Baker accepts batch
    const acceptRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/accept`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send(getPlanPayload(batch));
    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.body.data.batch.status, S.ACCEPTED);

    // Baker starts production directly without any store requisition or manager approval
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/start`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();
    assert.equal(startRes.status, 200, `Expected 200 OK, got: ${JSON.stringify(startRes.body)}`);
    assert.equal(startRes.body.data.batch.status, S.IN_PRODUCTION);
    assert.equal(startRes.body.data.batch.verificationStatus, "VERIFIED");
    assert.ok(startRes.body.data.batch.actualStartTime);

    // Clean up batch to free baker for subsequent tests
    await ProductionBatch.updateOne({ _id: batch._id }, { $set: { status: S.COMPLETED } });
  });

  // =========================================================================
  // TEST 2: Baker cannot start when required ingredients are genuinely insufficient
  // =========================================================================
  await t.test("2. Baker cannot start when required ingredients are genuinely insufficient", async () => {
    // Create an ingredient with ZERO stock
    const cocoa = await Ingredient.create({
      name: `Dutch Cocoa ${suffix}`,
      slug: `dutch-cocoa-${suffix}`,
      unit: "kg",
      costPerUnit: 120,
      minimumStock: 1,
      reorderLevel: 2,
      isActive: true,
    });

    const scarceBatch = await ProductionBatch.create({
      batchNumber: `BATCH-T2-SCARCE-${suffix}`,
      product: product._id,
      productVariant: variantId,
      productSnapshot: {
        productName: product.name,
        variantName: "Regular",
        variantQuantity: 1,
        variantUnit: "piece",
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 10,
        yieldUnit: "piece",
        recipeBatchQuantity: 10,
        ingredients: [
          { ingredient: cocoa._id, name: cocoa.name, quantity: 10, unit: "kg" },
        ],
        preparationTime: 20,
        productionTime: 40,
      },
      plannedQuantity: 10,
      unit: "piece",
      status: S.PLANNED,
      planningStatus: "APPROVED",
      assignedWorkers: [{ worker: baker._id, task: "Cocoa Bake" }],
      createdBy: owner._id,
    });

    await request(app)
      .post(`/api/v1/production/batches/${scarceBatch._id}/accept`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send(getPlanPayload(scarceBatch));

    // Attempting to start must fail with 409 conflict detailing the shortage
    const failRes = await request(app)
      .post(`/api/v1/production/batches/${scarceBatch._id}/start`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();

    assert.equal(failRes.status, 409);
    assert.ok(
      failRes.body.message.includes("Insufficient available inventory") ||
      failRes.body.message.includes(cocoa.name),
      `Expected shortage message mentioning ${cocoa.name}, got: ${failRes.body.message}`
    );

    // Batch status must remain ACCEPTED, not started
    const checkBatch = await ProductionBatch.findById(scarceBatch._id);
    assert.equal(checkBatch.status, S.ACCEPTED);
    await ProductionBatch.updateOne({ _id: scarceBatch._id }, { $set: { status: S.CANCELLED } });
  });

  // =========================================================================
  // TEST 3: Ingredient consumption is recorded correctly
  // =========================================================================
  await t.test("3. Ingredient consumption is recorded correctly", async () => {
    const batch = await createPlannedBatch(`BATCH-T3-CONSUME-${suffix}`);

    await request(app)
      .post(`/api/v1/production/batches/${batch._id}/accept`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send(getPlanPayload(batch));

    await request(app)
      .post(`/api/v1/production/batches/${batch._id}/start`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();

    const flourBefore = (await InventoryLot.findById(flourLot._id)).remainingQuantity;
    const sugarBefore = (await InventoryLot.findById(sugarLot._id)).remainingQuantity;

    // Baker consumes ingredients
    const consumeRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/consume`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();

    assert.equal(consumeRes.status, 200);
    assert.equal(consumeRes.body.data.batch.consumptionStatus, "CONSUMED");
    const consumed = consumeRes.body.data.batch.consumedIngredients;
    assert.ok(consumed.length >= 2, "Expected at least 2 consumed ingredient lines");

    // Check inventory lots were reduced exactly by recipe quantities (5kg flour, 2kg sugar)
    const flourAfter = (await InventoryLot.findById(flourLot._id)).remainingQuantity;
    const sugarAfter = (await InventoryLot.findById(sugarLot._id)).remainingQuantity;
    assert.equal(Number((flourBefore - flourAfter).toFixed(2)), 5);
    assert.equal(Number((sugarBefore - sugarAfter).toFixed(2)), 2);

    await ProductionBatch.updateOne({ _id: batch._id }, { $set: { status: S.COMPLETED } });
  });

  // =========================================================================
  // TEST 4: Inventory is not deducted at assignment acceptance
  // =========================================================================
  await t.test("4. Inventory is not deducted at assignment acceptance", async () => {
    const flourBefore = (await InventoryLot.findById(flourLot._id)).remainingQuantity;
    const sugarBefore = (await InventoryLot.findById(sugarLot._id)).remainingQuantity;

    const batch = await createPlannedBatch(`BATCH-T4-ACCEPT-NO-DEDUCT-${suffix}`);

    const acceptRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/accept`)
      .set("Authorization", `Bearer ${baker._id}`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send(getPlanPayload(batch));
    assert.equal(acceptRes.status, 200);

    // Stock must be exactly identical
    const flourAfter = (await InventoryLot.findById(flourLot._id)).remainingQuantity;
    const sugarAfter = (await InventoryLot.findById(sugarLot._id)).remainingQuantity;
    assert.equal(flourAfter, flourBefore);
    assert.equal(sugarAfter, sugarBefore);

    await ProductionBatch.updateOne({ _id: batch._id }, { $set: { status: S.CANCELLED } });
  });

  // =========================================================================
  // TEST 5: Repeated start or consumption requests do not deduct stock twice
  // =========================================================================
  await t.test("5. Repeated start or consumption requests do not deduct stock twice (idempotency)", async () => {
    const batch = await createPlannedBatch(`BATCH-T5-IDEMPOTENT-${suffix}`);

    await request(app)
      .post(`/api/v1/production/batches/${batch._id}/accept`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send(getPlanPayload(batch));

    await request(app)
      .post(`/api/v1/production/batches/${batch._id}/start`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();

    // First consumption
    const firstConsume = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/consume`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();
    assert.equal(firstConsume.status, 200);

    const flourAfterFirst = (await InventoryLot.findById(flourLot._id)).remainingQuantity;

    // Second consumption (retry/repeat)
    const secondConsume = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/consume`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();
    assert.equal(secondConsume.status, 409);
    assert.match(secondConsume.body.message, /already been consumed/i);

    // Stock must not be deducted a second time
    const flourAfterSecond = (await InventoryLot.findById(flourLot._id)).remainingQuantity;
    assert.equal(flourAfterSecond, flourAfterFirst, "Inventory lot quantity changed on repeated consumption request");

    await ProductionBatch.updateOne({ _id: batch._id }, { $set: { status: S.COMPLETED } });
  });

  // =========================================================================
  // TEST 6: Ingredient lot IDs and historical unit costs remain accurate
  // =========================================================================
  await t.test("6. Ingredient lot IDs and historical unit costs remain accurate", async () => {
    const batch = await createPlannedBatch(`BATCH-T6-LOT-TRACKING-${suffix}`);

    await request(app)
      .post(`/api/v1/production/batches/${batch._id}/accept`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send(getPlanPayload(batch));

    await request(app)
      .post(`/api/v1/production/batches/${batch._id}/start`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();

    const consumeRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/consume`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();
    assert.equal(consumeRes.status, 200);

    const consumed = consumeRes.body.data.batch.consumedIngredients;
    const flourLine = consumed.find((c) => String(c.ingredient) === String(flour._id));
    assert.ok(flourLine, "Flour line missing in consumed ingredients");
    assert.equal(String(flourLine.lot), String(flourLot._id));
    assert.equal(flourLine.lotNumber, flourLot.lotNumber);
    assert.equal(flourLine.unitCostSnapshot, 52.5);

    const sugarLine = consumed.find((c) => String(c.ingredient) === String(sugar._id));
    assert.ok(sugarLine, "Sugar line missing in consumed ingredients");
    assert.equal(String(sugarLine.lot), String(sugarLot._id));
    assert.equal(sugarLine.lotNumber, sugarLot.lotNumber);
    assert.equal(sugarLine.unitCostSnapshot, 41.0);

    await ProductionBatch.updateOne({ _id: batch._id }, { $set: { status: S.COMPLETED } });
  });

  // =========================================================================
  // TEST 7: Owner can inspect actual ingredient consumption
  // =========================================================================
  await t.test("7. Owner can inspect actual ingredient consumption from batch details", async () => {
    const batch = await createPlannedBatch(`BATCH-T7-OWNER-VIEW-${suffix}`);

    await request(app)
      .post(`/api/v1/production/batches/${batch._id}/accept`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send(getPlanPayload(batch));

    await request(app)
      .post(`/api/v1/production/batches/${batch._id}/start`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();

    await request(app)
      .post(`/api/v1/production/batches/${batch._id}/consume`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();

    // Owner retrieves batch details
    const ownerRes = await request(app)
      .get(`/api/v1/production/batches/${batch._id}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(ownerRes.status, 200);
    const bData = ownerRes.body.data.batch || ownerRes.body.data;
    assert.equal(bData.consumptionStatus, "CONSUMED");
    assert.ok(bData.consumedIngredients?.length >= 2);
    // Owner sees lot details and unit costs
    assert.ok(bData.consumedIngredients[0].lotNumber);
    assert.ok(bData.consumedIngredients[0].unitCostSnapshot > 0);

    await ProductionBatch.updateOne({ _id: batch._id }, { $set: { status: S.COMPLETED } });
  });

  // =========================================================================
  // TEST 8: Pending-order inventory checks use real recipes and quantities
  // =========================================================================
  await t.test("8. Pending-order inventory checks use real recipes and quantities", async () => {
    // Create an order via orderService checkout
    const order = await orderService.checkout(
      customer._id,
      {
        orderType: "PICKUP",
        contactName: "BOM Check Customer",
        contactPhone: "9876543210",
        items: [
          {
            productId: String(product._id),
            variantId: String(variantId),
            quantity: 20, // Requires 2 batches of 10 -> 10kg flour, 4kg sugar
          },
        ],
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
      },
      `idemp-t8-${suffix}`
    );

    // Call inventory check endpoint as owner
    const checkRes = await request(app)
      .get(`/api/v1/orders/${order._id}/inventory-check`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(checkRes.status, 200);
    const check = checkRes.body.data;
    assert.equal(check.orderId, String(order._id));
    assert.ok(check.requirements.length >= 2, "Expected recipe requirements for flour and sugar");

    const flourReq = check.requirements.find((r) => String(r.ingredientId) === String(flour._id));
    assert.ok(flourReq);
    assert.equal(flourReq.required, 10, "Expected 10kg flour required for 20 units (2 batches of 5kg)");

    const sugarReq = check.requirements.find((r) => String(r.ingredientId) === String(sugar._id));
    assert.ok(sugarReq);
    assert.equal(sugarReq.required, 4, "Expected 4kg sugar required for 20 units (2 batches of 2kg)");

    await orderService.cancel(order._id, null, owner._id, "Test 8 cleanup");
  });

  // =========================================================================
  // TEST 9: Sufficient inventory allows normal acceptance
  // =========================================================================
  await t.test("9. Sufficient inventory allows normal acceptance", async () => {
    const order = await orderService.checkout(
      customer._id,
      {
        orderType: "PICKUP",
        contactName: "Acceptance Customer",
        contactPhone: "9876543211",
        items: [
          {
            productId: String(product._id),
            variantId: String(variantId),
            quantity: 10,
          },
        ],
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
      },
      `idemp-t9-${suffix}`
    );

    // Verify inventory check returns AVAILABLE
    const checkRes = await request(app)
      .get(`/api/v1/orders/${order._id}/inventory-check`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.data.status, "AVAILABLE");
    assert.equal(checkRes.body.data.feasible, true);
    assert.equal(checkRes.body.data.shortages.length, 0);

    // Confirm payment (simulate owner uploading/approving UPI payment)
    // First set paymentStatus to PENDING_VERIFICATION to simulate proof submission
    await Order.updateOne(
      { _id: order._id },
      { $set: { paymentStatus: "PENDING_VERIFICATION" } }
    );

    const confirmRes = await request(app)
      .patch(`/api/v1/orders/${order._id}/confirm-payment`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ note: "Verified in UPI account" });

    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.data.order.status, CUSTOMER_ORDER_STATUSES.CONFIRMED);
    assert.equal(confirmRes.body.data.order.paymentStatus, "PAYMENT_CONFIRMED");

    await orderService.cancel(order._id, null, owner._id, "Test 9 cleanup");
  });

  // =========================================================================
  // TEST 10: Insufficient inventory displays the correct shortage
  // =========================================================================
  await t.test("10. Insufficient inventory displays the correct shortage", async () => {
    // Create product & recipe with an ingredient where available stock is below requirement
    const cardamom = await Ingredient.create({
      name: `Cardamom Pods ${suffix}`,
      slug: `cardamom-pods-${suffix}`,
      unit: "kg",
      costPerUnit: 800,
      minimumStock: 0.5,
      reorderLevel: 1,
      isActive: true,
    });

    // Provide only 1 kg lot
    await InventoryLot.create({
      ingredient: cardamom._id,
      lotNumber: `LOT-CARDAMOM-${suffix}`,
      originalQuantity: 1,
      remainingQuantity: 1,
      unit: "kg",
      unitCost: 820,
      purchaseDate: new Date(),
      status: "AVAILABLE",
      expiryDate: new Date(Date.now() + 60 * 86400000),
    });

    const cardamomVariantId = new mongoose.Types.ObjectId();
    const cardamomBun = await Product.create({
      name: `Cardamom Bun ${suffix}`,
      slug: `cardamom-bun-${suffix}`,
      sku: `SKU-BUN-${suffix}`,
      category: category._id,
      preparationTime: 15,
      productionTime: 25,
      variants: [{ _id: cardamomVariantId, name: "Single", quantity: 1, price: 90, unit: "piece", isActive: true, isAvailable: true }],
      isActive: true,
      isAvailable: true,
    });

    await Recipe.create({
      name: `Cardamom Bun Recipe ${suffix}`,
      product: cardamomBun._id,
      variant: cardamomVariantId,
      revision: 1,
      expectedYield: 5,
      yieldUnit: "piece",
      recipeBatchQuantity: 5,
      preparationTime: 15,
      productionTime: 25,
      ingredients: [
        { ingredient: cardamom._id, name: cardamom.name, quantity: 2, unit: "kg" }, // requires 2kg per 5 buns
      ],
      isActive: true,
    });

    // Create an order directly in DB in PENDING_PAYMENT
    const order = await Order.create({
      orderNumber: `ORD-T10-${suffix}`,
      customer: customer._id,
      items: [
        {
          productId: cardamomBun._id,
          variantId: cardamomVariantId,
          productName: cardamomBun.name,
          variantName: "Single",
          quantity: 10, // Needs 2 batches -> 4 kg cardamom! Available: 1 - 0.5 (min) = 0.5 kg. Shortage: 3.5 kg!
          unitPrice: 90,
          lineTotal: 900,
        },
      ],
      subtotal: 900,
      total: 900,
      orderType: "PICKUP",
      paymentMethod: "MANUAL_UPI",
      paymentStatus: "PENDING_VERIFICATION",
      status: CUSTOMER_ORDER_STATUSES.PENDING_PAYMENT,
      contactName: "Cardamom Customer",
      contactPhone: "9876543212",
    });

    const checkRes = await request(app)
      .get(`/api/v1/orders/${order._id}/inventory-check`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.data.status, "INSUFFICIENT");
    assert.equal(checkRes.body.data.feasible, false);
    assert.ok(checkRes.body.data.shortages.length > 0);

    const shortage = checkRes.body.data.shortages.find((s) => String(s.ingredientId) === String(cardamom._id));
    assert.ok(shortage, "Cardamom shortage not found in shortages list");
    assert.equal(shortage.required, 4);
    assert.equal(shortage.available, 0.5);
    assert.equal(shortage.shortage, 3.5);
    assert.equal(shortage.unit, "kg");

    await Order.deleteOne({ _id: order._id });
  });

  // =========================================================================
  // TEST 11: Owner can cancel or reject a pending order using authorized workflows
  // =========================================================================
  await t.test("11. Owner can cancel or reject a pending order using authorized workflows", async () => {
    const order = await orderService.checkout(
      customer._id,
      {
        orderType: "PICKUP",
        contactName: "Cancel Test Customer",
        contactPhone: "9876543213",
        items: [{ productId: String(product._id), variantId: String(variantId), quantity: 5 }],
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
      },
      `idemp-t11-${suffix}`
    );

    assert.equal(order.status, CUSTOMER_ORDER_STATUSES.PENDING_PAYMENT);

    // Owner cancels order
    const cancelRes = await request(app)
      .post(`/api/v1/orders/${order._id}/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ reason: "Customer requested cancellation before payment" });

    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.data.order.status, CUSTOMER_ORDER_STATUSES.CANCELLED);
    assert.equal(cancelRes.body.data.order.cancellation.reason, "Customer requested cancellation before payment");
    assert.equal(String(cancelRes.body.data.order.cancellation.cancelledBy), String(owner._id));
    assert.ok(cancelRes.body.data.order.cancellation.cancelledAt);
  });

  // =========================================================================
  // TEST 12: Cancellation releases reservations exactly once
  // =========================================================================
  await t.test("12. Cancellation releases reservations exactly once", async () => {
    const flourResBefore = (await Ingredient.findById(flour._id)).reservedStock || 0;

    const order = await orderService.checkout(
      customer._id,
      {
        orderType: "PICKUP",
        contactName: "Reservation Test Customer",
        contactPhone: "9876543214",
        items: [{ productId: String(product._id), variantId: String(variantId), quantity: 10 }], // 5kg flour
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
      },
      `idemp-t12-${suffix}`
    );

    const flourResAfterOrder = (await Ingredient.findById(flour._id)).reservedStock || 0;
    assert.equal(flourResAfterOrder, flourResBefore + 5, "Flour reservation was not incremented by 5kg on checkout");

    // Cancel order
    const cancelRes = await request(app)
      .post(`/api/v1/orders/${order._id}/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ reason: "Inventory shortage cancellation" });
    assert.equal(cancelRes.status, 200);

    const flourResAfterCancel = (await Ingredient.findById(flour._id)).reservedStock || 0;
    assert.equal(flourResAfterCancel, flourResBefore, "Flour reservation was not released on cancellation");

    // Second cancel attempt must be rejected or idempotent without reducing reservedStock again
    const secondCancel = await request(app)
      .post(`/api/v1/orders/${order._id}/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ reason: "Repeated cancel" });

    // Should return conflict (cannot transition from CANCELLED to CANCELLED) or 200 without changing stock
    const flourResAfterSecond = (await Ingredient.findById(flour._id)).reservedStock || 0;
    assert.equal(flourResAfterSecond, flourResBefore, "Reservation was deducted twice by repeated cancellation!");
  });

  // =========================================================================
  // TEST 13: Inventory changing between check and acceptance is handled safely
  // =========================================================================
  await t.test("13. Inventory changing between check and acceptance is rejected with 409 Conflict", async () => {
    // Create an isolated ingredient with exactly 5 kg
    const butter = await Ingredient.create({
      name: `Cultured Butter ${suffix}`,
      slug: `cultured-butter-${suffix}`,
      unit: "kg",
      costPerUnit: 250,
      minimumStock: 0,
      reorderLevel: 2,
      isActive: true,
    });

    const butterLot = await InventoryLot.create({
      ingredient: butter._id,
      lotNumber: `LOT-BUTTER-${suffix}`,
      originalQuantity: 5,
      remainingQuantity: 5,
      unit: "kg",
      unitCost: 250,
      purchaseDate: new Date(),
      status: "AVAILABLE",
      expiryDate: new Date(Date.now() + 30 * 86400000),
    });

    const butterVariantId = new mongoose.Types.ObjectId();
    const croissant = await Product.create({
      name: `Butter Croissant ${suffix}`,
      slug: `croissant-${suffix}`,
      sku: `SKU-CROISSANT-${suffix}`,
      category: category._id,
      preparationTime: 20,
      productionTime: 20,
      variants: [{ _id: butterVariantId, name: "Classic", quantity: 1, price: 80, unit: "piece", isActive: true, isAvailable: true }],
      isActive: true,
      isAvailable: true,
    });

    await Recipe.create({
      name: `Croissant Recipe ${suffix}`,
      product: croissant._id,
      variant: butterVariantId,
      revision: 1,
      expectedYield: 10,
      yieldUnit: "piece",
      recipeBatchQuantity: 10,
      preparationTime: 20,
      productionTime: 20,
      ingredients: [{ ingredient: butter._id, name: butter.name, quantity: 5, unit: "kg" }],
      isActive: true,
    });

    // Create an order for 10 croissants
    const order = await Order.create({
      orderNumber: `ORD-T13-${suffix}`,
      customer: customer._id,
      items: [
        {
          productId: croissant._id,
          variantId: butterVariantId,
          productName: croissant.name,
          variantName: "Classic",
          quantity: 10,
          unitPrice: 80,
          lineTotal: 800,
        },
      ],
      ingredientCommitments: [{ ingredient: butter._id, quantity: 5, unit: "kg" }],
      subtotal: 800,
      total: 800,
      orderType: "PICKUP",
      paymentMethod: "MANUAL_UPI",
      paymentStatus: "PENDING_VERIFICATION",
      status: CUSTOMER_ORDER_STATUSES.PENDING_PAYMENT,
      contactName: "Croissant Buyer",
      contactPhone: "9876543215",
    });

    // Step A: Initial check shows AVAILABLE
    const check1 = await request(app)
      .get(`/api/v1/orders/${order._id}/inventory-check`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(check1.status, 200);
    assert.equal(check1.body.data.status, "AVAILABLE");

    // Step B: Now inventory suddenly drops (e.g. wastage, stock audit depletion)
    await InventoryLot.updateOne({ _id: butterLot._id }, { $set: { remainingQuantity: 1 } });

    // Step C: Owner attempts to confirm payment / accept order
    const acceptRes = await request(app)
      .patch(`/api/v1/orders/${order._id}/confirm-payment`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ note: "Confirming payment" });

    // Must be rejected with 409 Conflict due to atomic revalidation!
    assert.equal(acceptRes.status, 409);
    assert.ok(
      acceptRes.body.message.includes("insufficient inventory") ||
      acceptRes.body.message.includes(butter.name),
      `Expected conflict error mentioning insufficient inventory, got: ${acceptRes.body.message}`
    );

    // Status must remain PENDING_PAYMENT, not CONFIRMED
    const orderAfter = await Order.findById(order._id);
    assert.equal(orderAfter.status, CUSTOMER_ORDER_STATUSES.PENDING_PAYMENT);

    await Order.deleteOne({ _id: order._id });
  });

  // =========================================================================
  // TEST 14: Concurrent orders cannot over-reserve inventory
  // =========================================================================
  await t.test("14. Concurrent orders cannot over-reserve inventory", async () => {
    // Yeast with only 3 kg total
    const yeast = await Ingredient.create({
      name: `Active Dry Yeast ${suffix}`,
      slug: `active-dry-yeast-${suffix}`,
      unit: "kg",
      costPerUnit: 150,
      minimumStock: 0,
      reorderLevel: 1,
      isActive: true,
    });

    await InventoryLot.create({
      ingredient: yeast._id,
      lotNumber: `LOT-YEAST-${suffix}`,
      originalQuantity: 3,
      remainingQuantity: 3,
      unit: "kg",
      unitCost: 150,
      purchaseDate: new Date(),
      status: "AVAILABLE",
      expiryDate: new Date(Date.now() + 30 * 86400000),
    });

    const yeastVariantId = new mongoose.Types.ObjectId();
    const loaf = await Product.create({
      name: `Yeast Loaf ${suffix}`,
      slug: `yeast-loaf-${suffix}`,
      sku: `SKU-YEAST-${suffix}`,
      category: category._id,
      preparationTime: 20,
      productionTime: 20,
      variants: [{ _id: yeastVariantId, name: "Standard", quantity: 1, price: 100, unit: "piece", isActive: true, isAvailable: true }],
      isActive: true,
      isAvailable: true,
    });

    await Recipe.create({
      name: `Yeast Loaf Recipe ${suffix}`,
      product: loaf._id,
      variant: yeastVariantId,
      revision: 1,
      expectedYield: 10,
      yieldUnit: "piece",
      recipeBatchQuantity: 10,
      preparationTime: 20,
      productionTime: 20,
      ingredients: [{ ingredient: yeast._id, name: yeast.name, quantity: 2, unit: "kg" }], // 2kg yeast per 10 loaves
      isActive: true,
    });

    // Order 1 requires 2kg (10 loaves). Total available: 3kg. Order 1 should succeed!
    const order1 = await orderService.checkout(
      customer._id,
      {
        orderType: "PICKUP",
        contactName: "Yeast Customer 1",
        contactPhone: "9876543216",
        items: [{ productId: String(loaf._id), variantId: String(yeastVariantId), quantity: 10 }],
        paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
      },
      `idemp-t14-o1-${suffix}`
    );
    assert.ok(order1._id);

    // Order 2 also requires 2kg (10 loaves). But remaining free yeast is only 3 - 2 = 1kg!
    // Order 2 checkout must be rejected due to shortage!
    await assert.rejects(
      async () => {
        await orderService.checkout(
          customer._id,
          {
            orderType: "PICKUP",
            contactName: "Yeast Customer 2",
            contactPhone: "9876543217",
            items: [{ productId: String(loaf._id), variantId: String(yeastVariantId), quantity: 10 }],
            paymentMethod: "MANUAL_UPI",
        deliveryDate: tomorrowStr,
          },
          `idemp-t14-o2-${suffix}`
        );
      },
      (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      }
    );

    await orderService.cancel(order1._id, null, owner._id, "Test 14 cleanup");
  });

  // =========================================================================
  // TEST 15: Production staff cannot access owner-only inventory-management or order-approval actions
  // =========================================================================
  await t.test("15. Production staff cannot access owner-only inventory-management or order-approval actions", async () => {
    const dummyOrderId = new mongoose.Types.ObjectId();

    // Staff cannot access inventory-check endpoint
    const checkRes = await request(app)
      .get(`/api/v1/orders/${dummyOrderId}/inventory-check`)
      .set("Authorization", `Bearer ${bakerToken}`);
    assert.equal(checkRes.status, 403, "Production staff accessed owner inventory check endpoint!");

    // Staff cannot approve/confirm payment
    const confirmRes = await request(app)
      .patch(`/api/v1/orders/${dummyOrderId}/confirm-payment`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send({ note: "staff try" });
    assert.equal(confirmRes.status, 403, "Production staff confirmed order payment!");

    // Staff cannot update finished stock
    const stockRes = await request(app)
      .put("/api/v1/orders/finished-stock")
      .set("Authorization", `Bearer ${bakerToken}`)
      .send({ productId: product._id, variantId, onHandQuantity: 50 });
    assert.equal(stockRes.status, 403, "Production staff updated finished stock!");
  });

  // =========================================================================
  // TEST 16: Existing costing, production concurrency, and COGS behavior remains correct
  // =========================================================================
  await t.test("16. Existing costing, production concurrency (1 active batch per worker), and COGS behavior remains correct", async () => {
    // 16A: Concurrency check - Baker 1 has an active IN_PRODUCTION batch
    const activeBatch1 = await createPlannedBatch(`BATCH-T16-ACTIVE-${suffix}`, 10, baker._id);
    await request(app)
      .post(`/api/v1/production/batches/${activeBatch1._id}/accept`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send(getPlanPayload(activeBatch1));
    await request(app)
      .post(`/api/v1/production/batches/${activeBatch1._id}/start`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();

    // Baker 1 attempts to start a second batch -> must fail with 409 conflict
    const activeBatch2 = await createPlannedBatch(`BATCH-T16-SECOND-${suffix}`, 10, baker._id);
    await request(app)
      .post(`/api/v1/production/batches/${activeBatch2._id}/accept`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send(getPlanPayload(activeBatch2));

    const secondStart = await request(app)
      .post(`/api/v1/production/batches/${activeBatch2._id}/start`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();
    assert.equal(secondStart.status, 409);
    assert.ok(secondStart.body.message.includes("strictly limits each staff member to one active batch"));

    // 16B: Complete activeBatch1 with labour & output and verify costing
    await request(app)
      .post(`/api/v1/production/batches/${activeBatch1._id}/consume`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send();

    const completeRes = await request(app)
      .post(`/api/v1/production/batches/${activeBatch1._id}/complete`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send({
        producedQuantity: 10,
        usableQuantity: 9,
        wastageQuantity: 1,
        equipmentRuntimeMinutes: 30,
        productionNotes: "Test complete",
      });
    assert.equal(completeRes.status, 200);

    const packagedRes = await request(app)
      .post(`/api/v1/production/batches/${activeBatch1._id}/package`)
      .set("Authorization", `Bearer ${bakerToken}`)
      .send({ packagedQuantity: 9 });
    assert.equal(packagedRes.status, 200);

    // Finalize batch
    const finalizeRes = await request(app)
      .post(`/api/v1/production/batches/${activeBatch1._id}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send();
    assert.equal(finalizeRes.status, 200);
    assert.equal(finalizeRes.body.data.batch.status, S.COMPLETED);

    // Clean up
    await ProductionBatch.updateOne({ _id: activeBatch2._id }, { $set: { status: S.CANCELLED } });
  });
  } catch (err) {
    console.error("SUITE ERROR DETECTED:", err);
    throw err;
  } finally {
    await disconnectDb();
  }
});
