import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import Product from "../src/models/product.model.js";
import Category from "../src/models/category.model.js";
import Recipe from "../src/models/recipe.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import Order from "../src/models/order.model.js";
import User from "../src/models/user.model.js";
import { USER_ROLES, PRODUCTION_STATUS as S, CUSTOMER_ORDER_STATUSES } from "../src/utils/constants.js";
import { generateAccessToken } from "../src/utils/token.utils.js";

test("Baker Dashboard Workflow Redesign & Split Packaging Suite", async (t) => {
  await connectToDb();

  const suffix = `bdr_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // 1. Setup Users: Owner, Assigned Baker, Unassigned Baker
  const owner = await User.create({
    name: `Owner ${suffix}`,
    email: `owner_${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER,
    isActive: true,
  });
  const baker = await User.create({
    name: `Baker Chief ${suffix}`,
    email: `baker_${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    isActive: true,
  });
  const unassignedBaker = await User.create({
    name: `Other Baker ${suffix}`,
    email: `other_baker_${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    isActive: true,
  });

  const ownerAuth = { Authorization: `Bearer ${generateAccessToken(owner)}` };
  const bakerAuth = { Authorization: `Bearer ${generateAccessToken(baker)}` };
  const unassignedAuth = { Authorization: `Bearer ${generateAccessToken(unassignedBaker)}` };

  // 2. Setup Category, Product & Recipe
  const category = await Category.create({
    name: `Artisan Breads ${suffix}`,
    slug: `artisan-breads-${suffix}`,
    isActive: true,
  });

  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Sourdough Boule ${suffix}`,
    slug: `sourdough-boule-${suffix}`,
    sku: `SOURDOUGH-${suffix}`,
    category: category._id,
    variants: [
      {
        _id: variantId,
        name: "Standard 2kg Loaf",
        sku: `SOURDOUGH-2KG-${suffix}`,
        price: 350,
        costPricePaise: 12000,
        isDefault: true,
        quantity: 2,
        unit: "kg",
      },
    ],
    totalTimeMinutes: 90,
    isActive: true,
  });

  // 3. Ingredients & Inventory Lots
  const flour = await Ingredient.create({
    name: `Organic Rye Flour ${suffix}`,
    slug: `rye-flour-${suffix}`,
    sku: `RYE-${suffix}`,
    category: "dry_goods",
    unit: "kg",
    costPerUnit: 40,
    minimumStock: 10,
    isActive: true,
  });

  const salt = await Ingredient.create({
    name: `Sea Salt ${suffix}`,
    slug: `sea-salt-${suffix}`,
    sku: `SALT-${suffix}`,
    category: "dry_goods",
    unit: "g",
    costPerUnit: 0.1,
    minimumStock: 50,
    isActive: true,
  });

  await InventoryLot.create({
    lotNumber: `LOT-RYE-${suffix}`,
    ingredient: flour._id,
    originalQuantity: 50,
    remainingQuantity: 50,
    unit: "kg",
    unitCost: 40,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  await InventoryLot.create({
    lotNumber: `LOT-SALT-${suffix}`,
    ingredient: salt._id,
    originalQuantity: 2000,
    remainingQuantity: 2000,
    unit: "g",
    unitCost: 0.1,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    ingredients: [
      { ingredient: flour._id, quantity: 1.5, unit: "kg" },
      { ingredient: salt._id, quantity: 30, unit: "g" },
    ],
    expectedYield: 2,
    yieldUnit: "kg",
    preparationTime: 30,
    productionTime: 60,
    estimatedDurationMinutes: 90,
    instructions: "Mix sourdough starter with rye flour and sea salt. Proof for 4 hours then bake at 230C.",
    isActive: true,
  });

  // 4. Setup Customer Orders with distinct remarks & pack preferences
  const order1 = await Order.create({
    orderNumber: `ORD-1-${suffix}`,
    customer: null,
    isGuest: true,
    guestId: `guest-1-${suffix}`,
    items: [
      {
        productId: product._id,
        variantId,
        productName: product.name,
        variantName: "Standard 2kg Loaf",
        quantity: 1,
        unitPrice: 350,
        lineTotal: 350,
        specialInstructions: "Customer 1: Please bake dark crust, no sesame",
        packInstructions: "Split into two 1 kg packs",
      },
    ],
    subtotal: 350,
    total: 350,
    orderType: "PICKUP",
    deliveryDate: "2026-10-31",
    deliveryTimeSlot: "10:00 - 12:00",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PAYMENT_CONFIRMED",
    contactName: "Alice Sourdough",
    contactPhone: "9876543210",
    specialInstructions: "Customer 1: Please bake dark crust, no sesame",
    packInstructions: "Split into two 1 kg packs",
    status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
  });

  const order2 = await Order.create({
    orderNumber: `ORD-2-${suffix}`,
    customer: null,
    isGuest: true,
    guestId: `guest-2-${suffix}`,
    items: [
      {
        productId: product._id,
        variantId,
        productName: product.name,
        variantName: "Standard 2kg Loaf",
        quantity: 1,
        unitPrice: 350,
        lineTotal: 350,
        specialInstructions: "Customer 2: Gift packaging requested",
      },
    ],
    subtotal: 350,
    total: 350,
    orderType: "DELIVERY",
    deliveryDate: "2026-10-31",
    deliveryTimeSlot: "14:00 - 16:00",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PAYMENT_CONFIRMED",
    contactName: "Bob Artisan",
    contactPhone: "9123456780",
    specialInstructions: "Customer 2: Gift packaging requested",
    status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
  });

  // 5. Create Batch assigned to baker with related orders & owner instructions
  const batch = await ProductionBatch.create({
    batchNumber: `BATCH-REDESIGN-${suffix}`,
    product: product._id,
    productVariant: variantId,
    productSnapshot: {
      productName: product.name,
      variantName: "Standard 2kg Loaf",
      variantQuantity: 2,
      variantUnit: "kg",
      totalTimeMinutes: 90,
    },
    recipe: recipe._id,
    recipeRevision: 1,
    recipeSnapshot: {
      expectedYield: 2,
      yieldUnit: "kg",
      recipeBatchQuantity: 2,
      ingredients: [
        { ingredient: flour._id, name: flour.name, quantity: 3.0, unit: "kg" },
        { ingredient: salt._id, name: salt.name, quantity: 60, unit: "g" },
      ],
      preparationTime: 30,
      productionTime: 60,
      estimatedDurationMinutes: 90,
    },
    plannedQuantity: 4, // 2 loaves of 2kg = 4kg
    unit: "kg",
    status: S.PLANNED,
    planningStatus: "APPROVED",
    relatedOrders: [order1._id, order2._id],
    syncOrderStatus: true,
    assignedWorkers: [{ worker: baker._id, task: "Mix and bake artisan rye sourdough" }],
    ownerInstructions: "Owner Note: VIP order for Alice & Bob. Ensure stone oven preheated to 240C.",
    productionNotes: order1.specialInstructions,
    createdBy: owner._id,
  });

  t.after(async () => {
    try {
      await ProductionBatch.deleteMany({ batchNumber: new RegExp(suffix) });
      await Order.deleteMany({ orderNumber: new RegExp(suffix) });
      await InventoryLot.deleteMany({ lotNumber: new RegExp(suffix) });
      await Recipe.deleteOne({ _id: recipe._id });
      await Product.deleteOne({ _id: product._id });
      await Category.deleteOne({ _id: category._id });
      await Ingredient.deleteMany({ _id: { $in: [flour._id, salt._id] } });
      await User.deleteMany({ email: new RegExp(suffix) });
    } catch {}
    await disconnectDb();
  });

  // TEST 1: Inspect Batch Populates Customer Remarks & Owner Instructions
  await t.test("1. Baker retrieves batch: customer remarks, pack preferences, and owner instructions are distinct", async () => {
    const res = await request(app)
      .get(`/api/v1/production/batches/${batch._id}`)
      .set(bakerAuth);

    assert.equal(res.status, 200);
    const b = res.body.data.batch;
    assert.equal(b.batchNumber, batch.batchNumber);
    assert.equal(b.ownerInstructions, "Owner Note: VIP order for Alice & Bob. Ensure stone oven preheated to 240C.");
    assert.equal(b.relatedOrders.length, 2);

    // Verify order 1 customer remarks & pack instructions
    const o1 = b.relatedOrders.find((o) => o._id === String(order1._id));
    assert.ok(o1);
    assert.equal(o1.specialInstructions, "Customer 1: Please bake dark crust, no sesame");
    assert.equal(o1.packInstructions, "Split into two 1 kg packs");

    // Verify order 2 customer remarks
    const o2 = b.relatedOrders.find((o) => o._id === String(order2._id));
    assert.ok(o2);
    assert.equal(o2.specialInstructions, "Customer 2: Gift packaging requested");
  });

  // TEST 2: Unassigned Baker is forbidden
  await t.test("2. Unassigned baker cannot accept the batch (403)", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/accept`)
      .set(unassignedAuth)
      .send({
        batchNumber: batch.batchNumber,
        product: String(product._id),
        plannedQuantity: 4,
        relatedOrders: [String(order1._id), String(order2._id)],
        assignedWorkers: [String(baker._id)],
      });
    assert.equal(res.status, 403);
  });

  // TEST 3: Stage 1 (Accept Batch)
  await t.test("3. Stage 1: Assigned baker accepts batch -> transitions to ACCEPTED", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/accept`)
      .set(bakerAuth)
      .send({
        batchNumber: batch.batchNumber,
        product: String(product._id),
        plannedQuantity: 4,
        relatedOrders: [String(order1._id), String(order2._id)],
        assignedWorkers: [String(baker._id)],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.batch.status, S.ACCEPTED);
  });

  // TEST 4: Recipe Requirements & Equipment are available for Stage 2
  await t.test("4. Stage 2 inspection: Recipe ingredients, required weights, pantry stock, and equipment returned", async () => {
    const res = await request(app)
      .get(`/api/v1/requisitions/batch/${batch._id}/requirements`)
      .set(bakerAuth);

    assert.equal(res.status, 200);
    const reqs = res.body.data;
    assert.equal(reqs.batchNumber, batch.batchNumber);
    assert.ok(Array.isArray(reqs.ingredients));
    assert.equal(reqs.ingredients.length, 2);

    // Check flour requirement
    const flourReq = reqs.ingredients.find((i) => String(i.ingredientId) === String(flour._id));
    assert.ok(flourReq);
    assert.equal(flourReq.requiredQuantity, 3); // 1.5kg * 2 = 3kg
    assert.equal(flourReq.status, "SUFFICIENT");

    // Check salt requirement
    const saltReq = reqs.ingredients.find((i) => String(i.ingredientId) === String(salt._id));
    assert.ok(saltReq);
    assert.equal(saltReq.requiredQuantity, 60); // 30g * 2 = 60g
    assert.equal(saltReq.status, "SUFFICIENT");

    // Check equipment returned
    assert.ok(Array.isArray(reqs.equipment));
    assert.ok(reqs.equipment.some((e) => e.includes("Oven")));
    assert.ok(reqs.equipment.some((e) => e.includes("Scale")));
  });

  // TEST 5: Stage 2 (Verify Ingredients, Weights & Equipment)
  await t.test("5. Stage 2: Confirm ingredients & equipment verified -> transitions to VERIFIED", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/verify`)
      .set(bakerAuth)
      .send({
        batchNumber: batch.batchNumber,
        product: String(product._id),
        plannedQuantity: 4,
        relatedOrders: [String(order1._id), String(order2._id)],
        assignedWorkers: [String(baker._id)],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.batch.status, S.VERIFIED);
  });

  // TEST 6: Stage 3 (Start Baking)
  await t.test("6. Stage 3: Start Baking -> transitions to IN_PRODUCTION and consumes inventory", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/start`)
      .set(bakerAuth)
      .send({ autoConsume: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.batch.status, S.IN_PRODUCTION);

    // Check that inventory was consumed
    const updatedBatch = await ProductionBatch.findById(batch._id);
    assert.equal(updatedBatch.consumptionStatus, "CONSUMED");

    // Orders transition to IN_PRODUCTION
    const o1 = await Order.findById(order1._id);
    assert.equal(o1.status, CUSTOMER_ORDER_STATUSES.IN_PRODUCTION);
  });

  // TEST 7: Stage 4 Validation - Output quantity must be positive
  await t.test("7. Stage 4: Record output rejects invalid/negative values (< 0 or 0)", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/complete`)
      .set(bakerAuth)
      .send({
        outputQuantity: -2,
        outputUnit: "kg",
      });
    assert.equal(res.status, 400);
  });

  // TEST 8: Stage 4 (Record Baking Output)
  await t.test("8. Stage 4: Baker records baking output (4.2 kg, unit kg, remark) -> transitions to PACKAGING", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/complete`)
      .set(bakerAuth)
      .send({
        outputQuantity: 4.2,
        outputUnit: "kg",
        outputRemark: "Slight nominal overrun, excellent golden rise",
      });

    assert.equal(res.status, 200);
    const b = res.body.data.batch;
    assert.equal(b.status, S.PACKAGING);
    assert.equal(b.actualOutputQuantity, 4.2);
    assert.equal(b.actualOutputUnit, "kg");
    assert.equal(b.bakerOutputRemark, "Slight nominal overrun, excellent golden rise");
    // Original planned yield is preserved untouched!
    assert.equal(b.plannedQuantity, 4);
  });

  // TEST 9: Stage 5 Validation - Total packaged cannot exceed available output
  await t.test("9. Stage 5: Overpackaging (> 4.2 kg) is rejected with 400 Bad Request", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/package`)
      .set(bakerAuth)
      .send({
        packages: [
          { packageNumber: 1, quantity: 2.5, unit: "kg", remark: "Pack 1" },
          { packageNumber: 2, quantity: 2.0, unit: "kg", remark: "Pack 2" }, // 4.5kg > 4.2kg
        ],
      });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /cannot exceed available baking output/i);
  });

  // TEST 10: Stage 5 (Split Packaging)
  await t.test("10. Stage 5: Split packaging into customer-requested packs (two 1kg packs + one 2kg pack + 200g loaf)", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/package`)
      .set(bakerAuth)
      .send({
        packages: [
          { packageNumber: 1, quantity: 1, unit: "kg", remark: "Order 1 - Pack 1 of 2", orderId: String(order1._id) },
          { packageNumber: 2, quantity: 1, unit: "kg", remark: "Order 1 - Pack 2 of 2", orderId: String(order1._id) },
          { packageNumber: 3, quantity: 2, unit: "kg", remark: "Order 2 - Standard 2kg Loaf", orderId: String(order2._id) },
          { packageNumber: 4, quantity: 0.2, unit: "kg", remark: "Sample mini loaf" },
        ],
        packagingRemark: "Split packages packed in food-grade kraft boxes with ribbon",
      });

    assert.equal(res.status, 200);
    const b = res.body.data.batch;
    assert.equal(b.status, S.PACKAGED);
    assert.equal(b.packagedQuantity, 4.2);
    assert.equal(b.packages.length, 4);
    assert.equal(b.packagingRemark, "Split packages packed in food-grade kraft boxes with ribbon");
  });

  // TEST 11: Stage 6 (Mark as Complete)
  await t.test("11. Stage 6: Mark as Complete -> transitions batch to COMPLETED and synchronizes orders to READY", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/finalize`)
      .set(bakerAuth);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.batch.status, S.COMPLETED);

    // Verify orders are synchronized to READY
    const o1 = await Order.findById(order1._id);
    assert.equal(o1.status, CUSTOMER_ORDER_STATUSES.READY);

    const o2 = await Order.findById(order2._id);
    assert.equal(o2.status, CUSTOMER_ORDER_STATUSES.READY);
  });
});
