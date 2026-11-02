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
import ProductionBatch from "../src/models/productionBatch.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import IngredientRequisition from "../src/models/ingredientRequisition.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";
import { costingService } from "../src/services/costing.service.js";

test("Production Timer, Estimated Time, Electricity Cost & Piece-Based Packaging Suite", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // 1. Create test users
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF]) {
    const user = await User.create({
      name: `Timer Test ${role}`,
      email: `${role.toLowerCase()}-${suffix}@timer-test.com`,
      password: "Password123!",
      role,
      hourlyLabourRate: 120, // ₹120/hr
      isActive: true,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }

  // Unassigned worker
  const otherStaff = await User.create({
    name: `Other Staff ${suffix}`,
    email: `other-staff-${suffix}@timer-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    hourlyLabourRate: 100,
    isActive: true,
  });
  users.OTHER_STAFF = { user: otherStaff, token: generateAccessToken(otherStaff) };

  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  // 2. Create category, product, variant, ingredient, lot, and recipe
  const category = await Category.create({ name: `Timer Category ${suffix}`, slug: `timer-cat-${suffix}` });
  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Timer Sourdough Loaf ${suffix}`,
    slug: `sourdough-${suffix}`,
    category: category._id,
    variants: [{ _id: variantId, name: "500g Loaf", quantity: 1, unit: "piece", price: 120, isActive: true }],
  });

  const flour = await Ingredient.create({ name: `Flour ${suffix}`, slug: `flour-${suffix}`, unit: "kg" });
  await InventoryLot.create({
    ingredient: flour._id,
    lotNumber: `LOT-FLOUR-${suffix}`,
    originalQuantity: 100,
    remainingQuantity: 100,
    unit: "kg",
    unitCost: 40, // ₹40/kg
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    ingredients: [{ ingredient: flour._id, quantity: 5, unit: "kg" }],
    expectedYield: 10,
    yieldUnit: "piece",
    preparationTime: 15,
    productionTime: 45,
    estimatedDurationMinutes: 60, // 60 mins estimated duration
    equipmentPowerKw: 3.0, // 3.0 kW oven power
    electricityTariff: 10.0, // ₹10.0 / kWh
    packagingMaterials: [
      { name: "Kraft Bread Box", costPerUnit: 4.5, consumptionType: "PER_PIECE", unitsPerItem: 1 },
      { name: "Bakery Logo Ribbon", costPerUnit: 15.0, consumptionType: "PER_BATCH", unitsPerItem: 1 },
    ],
    packagingCostPerUnit: 5.0,
  });

  let batchId = null;
  let batchNumber = null;

  t.after(async () => {
    if (batchId) {
      await ProductionBatch.deleteMany({ _id: batchId });
      await IngredientRequisition.deleteMany({ batch: batchId });
    }
    await InventoryTransaction.deleteMany({ ingredient: flour._id });
    await InventoryLot.deleteMany({ ingredient: flour._id });
    await FinishedProductStock.deleteMany({ product: product._id });
    await Recipe.deleteOne({ _id: recipe._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await Ingredient.deleteOne({ _id: flour._id });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@timer-test\\.com$`) });
    await disconnectDb();
  });

  // Test 1: Plan and verify batch creation with estimated duration and recipe snapshots
  await t.test("1. Create batch preserves recipe snapshots including power, tariff, packaging, and estimated duration", async () => {
    const res = await request(app)
      .post("/api/v1/production/batches")
      .set(auth(USER_ROLES.OWNER))
      .send({
        product: product._id.toString(),
        productVariant: variantId.toString(),
        plannedQuantity: 10,
        assignedWorkers: [{ worker: users.PRODUCTION_STAFF.user._id.toString(), task: "Bake Sourdough" }],
      });

    assert.equal(res.status, 201);
    const batch = res.body.data?.batch || res.body.data;
    batchId = batch._id;
    batchNumber = batch.batchNumber;

    assert.equal(batch.estimatedDurationMinutes, 60);
    assert.equal(batch.recipeSnapshot?.equipmentPowerKw, 3.0);
    assert.equal(batch.recipeSnapshot?.electricityTariff, 10.0);
    assert.equal(batch.recipeSnapshot?.packagingMaterials?.length, 2);
  });

  // Test 2: Unassigned staff cannot start the batch
  await t.test("2. Unassigned staff cannot accept, start, or package the batch", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batchId}/start`)
      .set(auth("OTHER_STAFF"))
      .send();
    assert.equal(res.status, 403);
  });

  // Test 3: Accept and verify batch
  await t.test("3. Assigned staff can accept and verify batch", async () => {
    const plan = {
      batchNumber,
      product: product._id.toString(),
      plannedQuantity: 10,
      relatedOrders: [],
      assignedWorkers: [users.PRODUCTION_STAFF.user._id.toString()],
    };

    const acceptRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/accept`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send(plan);
    assert.equal(acceptRes.status, 200);

    const verifyRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/verify`)
      .set(auth(USER_ROLES.MANAGER))
      .send(plan);
    assert.equal(verifyRes.status, 200);
  });

  // Test 4: Starting batch records actualStartTime and bakingStartTime once
  await t.test("4. Start batch persists actualStartTime and duplicate start does not overwrite original timestamp", async () => {
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send();
    assert.equal(startRes.status, 200);
    const started = startRes.body.data?.batch || startRes.body.data;
    assert.ok(started.actualStartTime);
    assert.ok(started.bakingStartTime);
    assert.equal(started.status, "IN_PRODUCTION");

    const initialStartTime = started.actualStartTime;

    // Simulate duplicate start call via service
    const currentBatch = await ProductionBatch.findById(batchId);
    currentBatch.status = "VERIFIED";
    currentBatch.verificationStatus = "VERIFIED";
    await currentBatch.save();

    // Re-call start
    const reStartRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send();
    assert.equal(reStartRes.status, 200);
    const reStarted = reStartRes.body.data?.batch || reStartRes.body.data;

    // Must preserve original timestamp!
    assert.equal(
      new Date(reStarted.actualStartTime).getTime(),
      new Date(initialStartTime).getTime(),
      "actualStartTime must not be reset on repeated start calls"
    );
  });

  // Test 5: Consume ingredients
  await t.test("5. Consume batch ingredients", async () => {
    const consumeRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/consume`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send();
    assert.equal(consumeRes.status, 200);
  });

  // Test 6: Overdue detection & delay reason recording on completion
  await t.test("6. Bake output completion records baking runtime, delay reason, and transitions to PACKAGING", async () => {
    // Simulate elapsed time greater than estimated 60 minutes
    const pastStart = new Date(Date.now() - 75 * 60 * 1000); // 75 mins ago
    await ProductionBatch.updateOne({ _id: batchId }, { $set: { actualStartTime: pastStart, bakingStartTime: pastStart } });

    const completeRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/complete`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({
        producedQuantity: 10,
        usableQuantity: 10,
        wastageQuantity: 0,
        equipmentRuntimeMinutes: 75,
        delayReason: "Extended crust caramelization required for dark loaf profile",
        productionNotes: "Oven maintained at 225C",
      });

    assert.equal(completeRes.status, 200);
    const completed = completeRes.body.data?.batch || completeRes.body.data;
    assert.equal(completed.status, "PACKAGING");
    assert.equal(completed.equipmentRuntimeMinutes, 75);
    assert.equal(completed.delayReason, "Extended crust caramelization required for dark loaf profile");
    assert.ok(completed.bakingEndTime);
  });

  // Test 7: Packaging and automatic costing finalization
  await t.test("7. Packaging batch triggers automatic costing finalization with piece-based packaging and electricity", async () => {
    const packageRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/package`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ packagedQuantity: 10 });

    assert.equal(packageRes.status, 200);
    const packaged = packageRes.body.data?.batch || packageRes.body.data;
    assert.equal(packaged.status, "PACKAGED");
    assert.equal(packaged.packagedQuantity, 10);

    // Fetch batch cost from costing endpoint
    const costRes = await request(app)
      .get(`/api/v1/production/batches/${batchId}/cost`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(costRes.status, 200);
    const cost = costRes.body.data?.cost || costRes.body.data;
    assert.equal(cost.status, "FINALIZED", "Costing must be auto-finalized upon packaging");

    // Verify Electricity calculation:
    // Power = 3.0 kW, Runtime = 75 mins = 1.25 hrs
    // Energy Consumed = 3.0 * 1.25 = 3.75 kWh
    // Electricity Cost = 3.75 kWh * ₹10/kWh = ₹37.50 = 3750 paise
    assert.ok(cost.electricityCost !== undefined);
    assert.equal(cost.electricityCost, 37.5);
    assert.equal(cost.electricitySnapshot?.powerKw, 3.0);
    assert.equal(cost.electricitySnapshot?.runtimeMinutes, 75);
    assert.equal(cost.electricitySnapshot?.tariffPerKwh, 10.0);
    assert.equal(cost.electricitySnapshot?.energyKwh, 3.75);

    // Verify Piece-Based Packaging calculation:
    // 10 pieces packaged:
    // 1. Kraft Bread Box: 10 pieces * 1 box * ₹4.50 = ₹45.00
    // 2. Bakery Logo Ribbon (PER_BATCH): 1 * ₹15.00 = ₹15.00
    // Total Packaging = ₹45 + ₹15 = ₹60.00
    assert.equal(cost.packagingCost, 60.0);
    assert.equal(cost.packagingSnapshots?.length, 2);

    // Verify Total Cost & Single-counting:
    // Ingredient: 5 kg * ₹40 = ₹200.00
    // Labour: Worker worked 1.25 hrs * ₹120/hr = ₹150.00
    // Packaging: ₹60.00
    // Electricity: ₹37.50
    // Total Cost = 200 + 150 + 60 + 37.50 = ₹447.50
    assert.equal(cost.ingredientCost, 200.0);
    assert.equal(cost.labourCost, 150.0);
    assert.equal(cost.totalCost, 447.5);

    // Cost Per Usable Item: 447.50 / 10 = ₹44.75
    assert.equal(cost.costPerUsableItem, 44.75);

    // Verify Overdue and delay reason in cost data:
    assert.equal(cost.estimatedDurationMinutes, 60);
    assert.equal(cost.equipmentRuntimeMinutes, 75);
    assert.equal(cost.delayReason, "Extended crust caramelization required for dark loaf profile");
  });

  // Test 8: Cannot re-package or package greater than usable yield
  await t.test("8. Cannot re-package or package quantity greater than usable yield", async () => {
    const duplicatePkgRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/package`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ packagedQuantity: 10 });
    assert.equal(duplicatePkgRes.status, 409, "Must reject duplicate packaging on already packaged batch");
  });

  // Test 9: Immutability of finalized costing
  await t.test("9. Finalized costing cannot be altered via draft or manual finalize", async () => {
    const draftRes = await request(app)
      .patch(`/api/v1/production/batches/${batchId}/cost/draft`)
      .set(auth(USER_ROLES.OWNER))
      .send({ packagingCost: 999, expenses: [] });
    assert.equal(draftRes.status, 409);

    const reFinalizeRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/cost/finalize`)
      .set(auth(USER_ROLES.OWNER))
      .send({ packagingCost: 999, expenses: [] });
    assert.equal(reFinalizeRes.status, 409);
  });

  // Test 10: Graceful handling and clear warning when recipe lacks power/tariff/packaging config
  await t.test("10. Fallback defaults and clear warnings work seamlessly when power/tariff/packaging config is omitted", async () => {
    const bareVariantId = new mongoose.Types.ObjectId();
    const bareProduct = await Product.create({
      name: `Bare Bread ${suffix}`,
      slug: `bare-${suffix}`,
      category: category._id,
      variants: [{ _id: bareVariantId, name: "Plain", quantity: 1, unit: "piece", price: 50, isActive: true }],
    });

    const bareRecipe = await Recipe.create({
      product: bareProduct._id,
      variant: bareVariantId,
      ingredients: [{ ingredient: flour._id, quantity: 1, unit: "kg" }],
      expectedYield: 5,
      yieldUnit: "piece",
      productionTime: 30,
    });

    const mockBatch = {
      _id: new mongoose.Types.ObjectId(),
      batchNumber: `BARE-${suffix}`,
      recipe: bareRecipe._id,
      consumedIngredients: [
        {
          ingredient: flour._id,
          ingredientName: "Flour",
          lot: new mongoose.Types.ObjectId(),
          lotNumber: "LOT-1",
          quantity: 1,
          unit: "kg",
          unitCostSnapshot: 40,
        },
      ],
      assignedWorkers: [
        {
          worker: users.PRODUCTION_STAFF.user._id,
          hourlyRateSnapshot: 100,
          actualHours: 0.5,
        },
      ],
      producedQuantity: 5,
      usableQuantity: 5,
      wastageQuantity: 0,
      equipmentRuntimeMinutes: 30,
      actualStartTime: new Date(Date.now() - 30 * 60 * 1000),
      actualCompletionTime: new Date(),
    };

    const calc = await costingService.actualComponents(mockBatch);
    // When recipe lacks equipmentPowerKw, electricity cost is 0 and warning is clearly flagged
    assert.equal(calc.electricityCostPaise, 0);
    assert.equal(calc.electricitySnapshot.powerKw, 0);
    assert.equal(calc.electricitySnapshot.powerRatingMissing, true);

    // Total Cost = 40 (ingredient) + 50 (labour) + 0 (packaging) + 0 (electricity) = ₹90.00
    assert.equal(calc.totalCostPaise, 9000);

    await Recipe.deleteOne({ _id: bareRecipe._id });
    await Product.deleteOne({ _id: bareProduct._id });
  });
});
