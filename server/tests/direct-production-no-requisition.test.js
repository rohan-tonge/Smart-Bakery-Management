process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import inventoryService from "../src/services/inventory.service.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import Recipe from "../src/models/recipe.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import InventoryTransaction from "../src/models/inventoryTransaction.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import IngredientRequisition, { REQUISITION_STATUS } from "../src/models/ingredientRequisition.model.js";
import Order from "../src/models/order.model.js";
import Notification from "../src/models/notification.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES, PRODUCTION_STATUS as S, CUSTOMER_ORDER_STATUSES } from "../src/utils/constants.js";

test("Direct Production Workflow Without Mandatory Requisition Suite", async (t) => {
  try {
    await connectToDb();

    const suffix = `direct-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // 1. Create Users
  const owner = await User.create({
    name: `Owner ${suffix}`,
    email: `owner-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER_MANAGER,
    isActive: true,
  });
  const ownerAuth = { Authorization: `Bearer ${generateAccessToken(owner)}` };

  const baker = await User.create({
    name: `Assigned Baker ${suffix}`,
    email: `baker-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    jobDesignation: "Head Baker",
    hourlyLabourRate: 200,
    isActive: true,
  });
  const bakerAuth = { Authorization: `Bearer ${generateAccessToken(baker)}` };

  const unassignedBaker = await User.create({
    name: `Other Baker ${suffix}`,
    email: `other-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    jobDesignation: "Junior Baker",
    hourlyLabourRate: 120,
    isActive: true,
  });
  const unassignedBakerAuth = { Authorization: `Bearer ${generateAccessToken(unassignedBaker)}` };

  const customer = await User.create({
    name: `Customer ${suffix}`,
    email: `customer-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
    isActive: true,
  });

  // 2. Create Category and Ingredients
  const category = await Category.create({
    name: `Breads ${suffix}`,
    slug: `breads-${suffix}`,
    isActive: true,
  });

  const flour = await Ingredient.create({
    name: `Flour ${suffix}`,
    slug: `flour-${suffix}`,
    sku: `FLOUR-${suffix}`,
    category: "dry_goods",
    unit: "g",
    currentStock: 10000,
    costPerUnit: 0.05,
    minimumStock: 100,
    reorderQuantity: 2000,
    isActive: true,
  });

  const yeast = await Ingredient.create({
    name: `Yeast ${suffix}`,
    slug: `yeast-${suffix}`,
    sku: `YEAST-${suffix}`,
    category: "dry_goods",
    unit: "g",
    currentStock: 1000,
    costPerUnit: 0.20,
    minimumStock: 50,
    reorderQuantity: 500,
    isActive: true,
  });

  const flourLot = await InventoryLot.create({
    lotNumber: `LOT-FLOUR-${suffix}`,
    ingredient: flour._id,
    originalQuantity: 10000,
    remainingQuantity: 10000,
    unit: "g",
    unitCost: 0.05,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  const yeastLot = await InventoryLot.create({
    lotNumber: `LOT-YEAST-${suffix}`,
    ingredient: yeast._id,
    originalQuantity: 1000,
    remainingQuantity: 1000,
    unit: "g",
    unitCost: 0.20,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  // 3. Create Product and Recipe
  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Artisan Sourdough ${suffix}`,
    slug: `artisan-sourdough-${suffix}`,
    category: category._id,
    basePrice: 150,
    pricingType: "BY_UNIT",
    variants: [
      {
        _id: variantId,
        name: "Standard Loaf",
        sku: `BREAD-${suffix}`,
        quantity: 1,
        unit: "piece",
        price: 150,
        servings: 1,
        weight: 500,
        weightUnit: "g",
        isDefault: true,
        isActive: true,
        isAvailable: true,
      },
    ],
    isActive: true,
    isAvailable: true,
  });

  const recipe = await Recipe.create({
    name: `Sourdough Recipe ${suffix}`,
    product: product._id,
    variant: variantId,
    revision: 1,
    recipeBatchQuantity: 2,
    yieldUnit: "piece",
    expectedYield: 2,
    preparationTime: 15,
    productionTime: 30,
    ingredients: [
      { ingredient: flour._id, name: flour.name, quantity: 500, unit: "g" },
      { ingredient: yeast._id, name: yeast.name, quantity: 20, unit: "g" },
    ],
    instructions: "Mix ingredients. Proof dough. Bake at 220C",
    isActive: true,
  });

  // 4. Create Confirmed Customer Order
  const order = await Order.create({
    orderNumber: `ORD-${suffix}`,
    customer: customer._id,
    customerName: "Jane Doe",
    customerPhone: "9876543210",
    contactName: "Jane Doe",
    contactPhone: "+91 98765 43210",
    status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
    paymentStatus: "PAYMENT_CONFIRMED",
    paymentMethod: "COD",
    orderType: "PICKUP",
    items: [
      {
        productId: product._id,
        variantId,
        productName: product.name,
        variantName: "Standard Loaf",
        quantity: 2,
        unitPrice: 150,
        lineTotal: 300,
      },
    ],
    subtotal: 300,
    total: 300,
  });

  // 5. Create Batch assigned to baker
  const batch = await ProductionBatch.create({
    batchNumber: `BATCH-${suffix}`,
    product: product._id,
    productVariant: variantId,
    productSnapshot: {
      productName: product.name,
      variantName: "Standard Loaf",
      variantQuantity: 1,
      variantUnit: "piece",
    },
    recipe: recipe._id,
    recipeRevision: 1,
    recipeSnapshot: {
      expectedYield: 2,
      yieldUnit: "piece",
      recipeBatchQuantity: 2,
      ingredients: [
        { ingredient: flour._id, name: flour.name, quantity: 500, unit: "g" },
        { ingredient: yeast._id, name: yeast.name, quantity: 20, unit: "g" },
      ],
      preparationTime: 15,
      productionTime: 30,
    },
    plannedQuantity: 2,
    unit: "piece",
    status: S.PLANNED,
    planningStatus: "APPROVED",
    relatedOrders: [order._id],
    syncOrderStatus: true,
    assignedWorkers: [{ worker: baker._id, task: "Mix and Bake Sourdough" }],
    createdBy: owner._id,
  });

  t.after(async () => {
    try {
      await ProductionBatch.deleteMany({ batchNumber: new RegExp(suffix) });
      await Order.deleteMany({ orderNumber: new RegExp(suffix) });
      await IngredientRequisition.deleteMany({ batch: batch._id });
      await InventoryLot.deleteMany({ lotNumber: new RegExp(suffix) });
      await InventoryTransaction.deleteMany({ referenceId: batch._id });
      await Recipe.deleteOne({ _id: recipe._id });
      await Product.deleteOne({ _id: product._id });
      await Category.deleteOne({ _id: category._id });
      await Ingredient.deleteMany({ _id: { $in: [flour._id, yeast._id] } });
      await User.deleteMany({ email: new RegExp(suffix) });
    } catch {}
    await disconnectDb();
  });

  // TEST 1: Unauthorized staff cannot start batch
  await t.test("1. Unauthorized staff cannot accept or start the batch (403)", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/start`)
      .set(unassignedBakerAuth);
    assert.equal(res.status, 403);
  });

  // TEST 2: Baker accepts assigned batch
  await t.test("2. Assigned baker accepts batch without requisition", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/accept`)
      .set(bakerAuth)
      .send({
        batchNumber: batch.batchNumber,
        product: String(product._id),
        plannedQuantity: 2,
        relatedOrders: [String(order._id)],
        assignedWorkers: [String(baker._id)],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.batch.status, S.ACCEPTED);
  });

  // TEST 3: Baker directly starts production without any ingredient requisition
  await t.test("3. Baker starts production directly without any requisition; order moves to IN_PRODUCTION", async () => {
    // Confirm NO requisitions exist for this batch
    const reqCount = await IngredientRequisition.countDocuments({ batch: batch._id });
    assert.equal(reqCount, 0, "No requisitions must exist before starting");

    const startRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/start`)
      .set(bakerAuth);

    assert.equal(startRes.status, 200, `Start failed: ${JSON.stringify(startRes.body)}`);
    assert.equal(startRes.body.data.batch.status, S.IN_PRODUCTION);

    // Verify linked customer order moved to IN_PRODUCTION
    const updatedOrder = await Order.findById(order._id);
    assert.equal(updatedOrder.status, CUSTOMER_ORDER_STATUSES.IN_PRODUCTION);

    // Verify NO requisitions were automatically created behind the scenes
    const postReqCount = await IngredientRequisition.countDocuments({ batch: batch._id });
    assert.equal(postReqCount, 0, "No requisitions should be automatically created behind the scenes");
  });

  // TEST 4: Baker consumes recipe ingredients directly via /consume endpoint
  await t.test("4. Baker consumes ingredients via /consume: stock deducted and transactions recorded", async () => {
    const consumeRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/consume`)
      .set(bakerAuth);

    assert.equal(consumeRes.status, 200);
    assert.equal(consumeRes.body.data.batch.consumptionStatus, "CONSUMED");

    // Check inventory lots deducted
    const flourLotUpdated = await InventoryLot.findById(flourLot._id);
    assert.equal(flourLotUpdated.remainingQuantity, 10000 - 500);

    const yeastLotUpdated = await InventoryLot.findById(yeastLot._id);
    assert.equal(yeastLotUpdated.remainingQuantity, 1000 - 20);

    // Check live calculated stock
    const flourStock = await inventoryService.getCurrentStock(flour._id);
    assert.equal(flourStock.currentStock, 10000 - 500);

    const yeastStock = await inventoryService.getCurrentStock(yeast._id);
    assert.equal(yeastStock.currentStock, 1000 - 20);

    // Verify inventory transactions recorded
    const txs = await InventoryTransaction.find({ referenceId: batch._id });
    assert.ok(txs.length >= 2, "Inventory transactions must be logged for consumption");
  });

  // TEST 5: Repeated consumption attempt is blocked (no double deductions)
  await t.test("5. Repeated consumption call is rejected with 409 Conflict without double deducting", async () => {
    const dupRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/consume`)
      .set(bakerAuth);

    assert.equal(dupRes.status, 409);
    assert.match(dupRes.body.message, /already been consumed/i);

    // Verify stock was not deducted again
    const flourLotCheck = await InventoryLot.findById(flourLot._id);
    assert.equal(flourLotCheck.remainingQuantity, 9500);
  });

  // TEST 6: Pre-start stock shortage validation blocks production start with 409
  await t.test("6. Insufficient stock blocks start with 409 and shortage details", async () => {
    try {
      // Create an idle baker without running batches
      const shortageBaker = await User.create({
        name: `Shortage Baker ${suffix}`,
        email: `shortage-baker-${suffix}@test.com`,
        password: "Password123!",
        role: USER_ROLES.PRODUCTION_STAFF,
        isActive: true,
      });
      const shortageBakerAuth = { Authorization: `Bearer ${generateAccessToken(shortageBaker)}` };

      // Create an ingredient with very low stock
      const rareSeed = await Ingredient.create({
        name: `Chia Seeds ${suffix}`,
        slug: `chia-seeds-${suffix}`,
        sku: `CHIA-${suffix}`,
        category: "dry_goods",
        unit: "g",
        costPerUnit: 1.0,
        minimumStock: 10,
        isActive: true,
      });

      const rareLot = await InventoryLot.create({
        lotNumber: `LOT-CHIA-${suffix}`,
        ingredient: rareSeed._id,
        originalQuantity: 5,
        remainingQuantity: 5, // only 5g available
        unit: "g",
        unitCost: 1.0,
        purchaseDate: new Date(),
        status: "AVAILABLE",
      });

      const shortBatch = await ProductionBatch.create({
        batchNumber: `BATCH-SHORT-${suffix}`,
        product: product._id,
        productVariant: variantId,
        productSnapshot: {
          productName: product.name,
          variantName: "Standard Loaf",
          variantQuantity: 1,
          variantUnit: "piece",
        },
        recipe: recipe._id,
        recipeRevision: 1,
        recipeSnapshot: {
          expectedYield: 1,
          yieldUnit: "piece",
          recipeBatchQuantity: 1,
          ingredients: [
            { ingredient: rareSeed._id, name: rareSeed.name, quantity: 50, unit: "g" }, // requires 50g
          ],
        },
        plannedQuantity: 1,
        unit: "piece",
        status: S.ACCEPTED,
        assignedWorkers: [{ worker: shortageBaker._id, task: "Shortage Test" }],
        createdBy: owner._id,
      });

      const failRes = await request(app)
        .post(`/api/v1/production/batches/${shortBatch._id}/start`)
        .set(shortageBakerAuth);

      assert.equal(failRes.status, 409);
      assert.match(failRes.body.message, /Insufficient available inventory/i);

      // Cleanup shortage test records
      await ProductionBatch.deleteOne({ _id: shortBatch._id });
      await InventoryLot.deleteOne({ _id: rareLot._id });
      await Ingredient.deleteOne({ _id: rareSeed._id });
      await User.deleteOne({ _id: shortageBaker._id });
    } catch (err) {
      console.error("SUBTEST 6 CRASHED AT:", err);
      throw err;
    }
  });

  // TEST 7: Full production state transitions work and move order to READY upon packaging
  await t.test("7. Complete -> Packaging -> Packaged moves order to READY", async () => {
    // Step: Complete baking
    const compRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/complete`)
      .set(bakerAuth)
      .send({
        producedQuantity: 2,
        usableQuantity: 2,
        wastageQuantity: 0,
        productionNotes: "Golden brown crust",
      });
    assert.equal(compRes.status, 200);
    assert.equal(compRes.body.data.batch.status, S.PACKAGING);

    // Order remains IN_PRODUCTION during packaging stage
    const orderInPacking = await Order.findById(order._id);
    assert.equal(orderInPacking.status, CUSTOMER_ORDER_STATUSES.IN_PRODUCTION);

    // Step: Finish packaging
    const packRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/package`)
      .set(bakerAuth)
      .send({ packagedQuantity: 2 });
    assert.equal(packRes.status, 200);
    assert.equal(packRes.body.data.batch.status, S.PACKAGED);

    // Order transitions to READY
    const readyOrder = await Order.findById(order._id);
    assert.equal(readyOrder.status, CUSTOMER_ORDER_STATUSES.READY);

    // Step: Finalize batch
    const finRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/finalize`)
      .set(bakerAuth);
    assert.equal(finRes.status, 200);
    assert.equal(finRes.body.data.batch.status, S.COMPLETED);

    // Order remains READY
    const finalOrder = await Order.findById(order._id);
    assert.equal(finalOrder.status, CUSTOMER_ORDER_STATUSES.READY);
  });
  } catch (err) {
    console.error("DIRECT PRODUCTION TEST FAILED WITH:", err);
    throw err;
  }
});
