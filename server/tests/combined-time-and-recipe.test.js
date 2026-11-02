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
import InventoryTransaction from "../src/models/inventoryTransaction.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES, UNITS } from "../src/utils/constants.js";

test("Smart Bakery — Combined Time and Recipe Management Regression Suite", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create test actors
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF, USER_ROLES.CUSTOMER]) {
    const user = await User.create({
      name: `Time Test ${role}`,
      email: `${role.toLowerCase()}-${suffix}@time-test.com`,
      password: "Password123!",
      role,
      hourlyLabourRate: 200,
      isActive: true,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  const category = await Category.create({
    name: `Time Category ${suffix}`,
    slug: `time-cat-${suffix}`,
  });

  const flour = await Ingredient.create({
    name: `Test Flour ${suffix}`,
    slug: `test-flour-${suffix}`,
    unit: UNITS.KILOGRAM,
  });

  const sugar = await Ingredient.create({
    name: `Test Sugar ${suffix}`,
    slug: `test-sugar-${suffix}`,
    unit: UNITS.KILOGRAM,
  });

  const flourLot = await InventoryLot.create({
    ingredient: flour._id,
    lotNumber: `LOT-TF-${suffix}`,
    originalQuantity: 500,
    remainingQuantity: 500,
    unit: UNITS.KILOGRAM,
    unitCost: 20,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  const sugarLot = await InventoryLot.create({
    ingredient: sugar._id,
    lotNumber: `LOT-TS-${suffix}`,
    originalQuantity: 500,
    remainingQuantity: 500,
    unit: UNITS.KILOGRAM,
    unitCost: 40,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  let createdProductId;
  let createdVariantId;
  let createdBatchId;

  t.after(async () => {
    // Cleanup test artifacts
    if (createdBatchId) {
      await ProductionBatch.deleteMany({ _id: createdBatchId });
      await FinishedProductStock.deleteMany({ batch: createdBatchId });
    }
    if (createdProductId) {
      await Recipe.deleteMany({ product: createdProductId });
      await Product.deleteMany({ _id: createdProductId });
    }
    await Product.deleteMany({ name: { $regex: suffix } });
    await InventoryLot.deleteMany({ lotNumber: { $regex: suffix } });
    await InventoryTransaction.deleteMany({ notes: { $regex: suffix } });
    await Ingredient.deleteMany({ _id: { $in: [flour._id, sugar._id] } });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ email: { $regex: suffix } });
    await disconnectDb();
  });

  // =========================================================================
  // Test 1: Product creation with "totalTimeMinutes"
  // =========================================================================
  await t.test("1. Product creation accepts and stores totalTimeMinutes", async () => {
    const res = await request(app)
      .post("/api/v1/products")
      .set(auth(USER_ROLES.OWNER))
      .send({
        name: `Time Test Bread ${suffix}`,
        slug: `time-bread-${suffix}`,
        category: String(category._id),
        totalTimeMinutes: 75,
        electricityCostPerUnit: 5,
        packagingCostPerUnit: 2,
        variants: [
          {
            name: "Standard Loaf",
            quantity: 1,
            unit: UNITS.PIECE,
            price: 60,
          },
        ],
      });

    assert.equal(res.status, 201, `Failed: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.product.totalTimeMinutes, 75);
    assert.equal(res.body.data.product.electricityCostPerUnit, 5);
    assert.equal(res.body.data.product.packagingCostPerUnit, 2);

    createdProductId = res.body.data.product._id;

    // Add product variant
    const variantRes = await request(app)
      .post(`/api/v1/products/${createdProductId}/variants`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        name: "Standard Loaf",
        quantity: 1,
        unit: "piece",
        price: 60,
      });
    assert.equal(variantRes.status, 201);
    createdVariantId = variantRes.body.data.variant._id;
  });

  // =========================================================================
  // Test 2: Product validation rejects negative totalTimeMinutes
  // =========================================================================
  await t.test("2. Product validation rejects negative totalTimeMinutes", async () => {
    const res = await request(app)
      .patch(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        totalTimeMinutes: -10,
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  // =========================================================================
  // Test 3: Updating product with totalTimeMinutes
  // =========================================================================
  await t.test("3. Updating product totalTimeMinutes updates record properly", async () => {
    const updateRes = await request(app)
      .patch(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        totalTimeMinutes: 90,
      });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.product.totalTimeMinutes, 90);

    // Verify fetched product
    const getRes = await request(app)
      .get(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.product.totalTimeMinutes, 90);
  });

  // =========================================================================
  // Test 4: Recipe creation with totalTimeMinutes & ingredient validations
  // =========================================================================
  await t.test("4. Recipe creation accepts totalTimeMinutes and validates ingredients", async () => {
    // Delete auto-created recipe so we can test explicit creation
    await Recipe.deleteMany({ product: createdProductId, variant: createdVariantId });

    // Attempt recipe with empty ingredients
    const emptyIngRes = await request(app)
      .post(`/api/v1/products/${createdProductId}/variants/${createdVariantId}/recipe`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        totalTimeMinutes: 90,
        expectedYield: 10,
        yieldUnit: UNITS.PIECE,
        ingredients: [],
      });
    assert.equal(emptyIngRes.status, 400, `Empty ing rejected: ${JSON.stringify(emptyIngRes.body)}`);

    // Attempt recipe with duplicate ingredients
    const dupRes = await request(app)
      .post(`/api/v1/products/${createdProductId}/variants/${createdVariantId}/recipe`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        totalTimeMinutes: 90,
        expectedYield: 10,
        yieldUnit: UNITS.PIECE,
        ingredients: [
          { ingredient: String(flour._id), quantity: 2, unit: UNITS.KILOGRAM },
          { ingredient: String(flour._id), quantity: 1, unit: UNITS.KILOGRAM },
        ],
      });
    assert.equal(dupRes.status, 400, `Duplicate ing rejected: ${JSON.stringify(dupRes.body)}`);

    // Valid recipe creation
    const recipeRes = await request(app)
      .post(`/api/v1/products/${createdProductId}/variants/${createdVariantId}/recipe`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        totalTimeMinutes: 90,
        expectedYield: 10,
        yieldUnit: UNITS.PIECE,
        ingredients: [
          { ingredient: String(flour._id), quantity: 2, unit: UNITS.KILOGRAM },
          { ingredient: String(sugar._id), quantity: 0.5, unit: UNITS.KILOGRAM },
        ],
      });

    assert.equal(recipeRes.status, 201, `Failed to create recipe: ${JSON.stringify(recipeRes.body)}`);
    assert.equal(recipeRes.body.success, true);
    assert.equal(recipeRes.body.data.recipe.totalTimeMinutes, 90);
    assert.equal(recipeRes.body.data.recipe.ingredients.length, 2);

    // Fetch recipe and confirm totalTimeMinutes is returned
    const getRecipeRes = await request(app)
      .get(`/api/v1/products/${createdProductId}/variants/${createdVariantId}/recipe`)
      .set(auth(USER_ROLES.OWNER));
    assert.equal(getRecipeRes.status, 200);
    assert.equal(getRecipeRes.body.data.recipe.totalTimeMinutes, 90);

    // Test Recipe PATCH with updated totalTimeMinutes
    const patchRecipeRes = await request(app)
      .patch(`/api/v1/products/${createdProductId}/variants/${createdVariantId}/recipe`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        totalTimeMinutes: 105,
      });
    assert.equal(patchRecipeRes.status, 200, `Patch failed: ${JSON.stringify(patchRecipeRes.body)}`);
    assert.equal(patchRecipeRes.body.data.recipe.totalTimeMinutes, 105);

    // Revert back to 90 for subsequent batch test
    await request(app)
      .patch(`/api/v1/products/${createdProductId}/variants/${createdVariantId}/recipe`)
      .set(auth(USER_ROLES.OWNER))
      .send({ totalTimeMinutes: 90 });
  });

  // =========================================================================
  // Test 5: Production cost is NOT calculated from total time
  // =========================================================================
  await t.test("5. Total time does NOT calculate or inflate production cost", async () => {
    // Create production batch for 10 units
    const batchRes = await request(app)
      .post("/api/v1/production/batches")
      .set(auth(USER_ROLES.MANAGER))
      .send({
        product: String(createdProductId),
        productVariant: String(createdVariantId),
        plannedQuantity: 10,
        assignedWorkers: [{ worker: String(users[USER_ROLES.PRODUCTION_STAFF].user._id), task: "Baking" }],
      });

    assert.equal(batchRes.status, 201, `Batch create failed: ${JSON.stringify(batchRes.body)}`);
    createdBatchId = batchRes.body.data.batch._id;
    const batchNumber = batchRes.body.data.batch.batchNumber;

    // Verify snapshot has totalTimeMinutes
    assert.equal(batchRes.body.data.batch.productSnapshot.totalTimeMinutes, 90);

    const plan = {
      batchNumber,
      product: String(createdProductId),
      plannedQuantity: 10,
      relatedOrders: [],
      assignedWorkers: [String(users[USER_ROLES.PRODUCTION_STAFF].user._id)],
    };

    // Accept batch
    const acceptRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/accept`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send(plan);
    assert.equal(acceptRes.status, 200, `Accept failed: ${JSON.stringify(acceptRes.body)}`);

    // Verify batch
    const verifyRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/verify`)
      .set(auth(USER_ROLES.MANAGER))
      .send(plan);
    assert.equal(verifyRes.status, 200, `Verify failed: ${JSON.stringify(verifyRes.body)}`);

    // Ensure any active requisition for this batch is issued so start can proceed
    const IngredientRequisition = (await import("../src/models/ingredientRequisition.model.js")).default;
    await IngredientRequisition.updateMany(
      { batch: createdBatchId },
      { $set: { status: "ISSUED", issuedBy: users[USER_ROLES.MANAGER].user._id, issuedAt: new Date() } }
    );

    // Start production
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({});
    assert.equal(startRes.status, 200, `Start failed: ${JSON.stringify(startRes.body)}`);

    // Consume ingredients: 2kg flour + 0.5kg sugar
    const consumeRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/consume`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({
        ingredients: [
          {
            ingredient: String(flour._id),
            lot: String(flourLot._id),
            quantity: 2,
            unit: UNITS.KILOGRAM,
          },
          {
            ingredient: String(sugar._id),
            lot: String(sugarLot._id),
            quantity: 0.5,
            unit: UNITS.KILOGRAM,
          },
        ],
      });
    assert.equal(consumeRes.status, 200);

    // Complete production with 10 usable units
    const compRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/complete`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ producedQuantity: 10, usableQuantity: 10, wastageQuantity: 0 });
    assert.equal(compRes.status, 200);

    // Package
    const pkgRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/package`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ packagedQuantity: 10 });
    assert.equal(pkgRes.status, 200);

    // Fetch batch costing
    const costRes = await request(app)
      .get(`/api/v1/production/batches/${createdBatchId}/cost`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(costRes.status, 200, `Cost failed: ${JSON.stringify(costRes.body)}`);
    const cost = costRes.body.data.cost;

    // Ingredients: 2kg flour @ 20 = 40; 0.5kg sugar @ 40 = 20 -> total ingredient = 60
    assert.equal(cost.ingredientCost, 60, `Ingredient cost must be 60, got ${cost.ingredientCost}`);
    // Electricity: 10 * 5 = 50
    assert.equal(cost.electricityCost, 50, `Electricity cost must be 50, got ${cost.electricityCost}`);
    // Packaging: 10 * 2 = 20
    assert.equal(cost.packagingCost, 20, `Packaging cost must be 20, got ${cost.packagingCost}`);
    // Total production cost: 60 + 50 + 20 = 130
    assert.equal(cost.totalCost, 130, `Total cost must be 130, got ${cost.totalCost}`);
    // Cost per unit: 130 / 10 = 13
    assert.equal(cost.costPerUnit, 13, `Cost per unit must be 13, got ${cost.costPerUnit}`);

    // NO LABOUR COST
    assert.equal(cost.labourCost, 0, "Labour cost must be 0");
  });

  // =========================================================================
  // Test 6: Legacy product fallback computes totalTimeMinutes seamlessly
  // =========================================================================
  await t.test("6. Legacy product without totalTimeMinutes derives prep + prod fallback", async () => {
    const legacyProduct = await Product.create({
      name: `Legacy Cake ${suffix}`,
      slug: `legacy-cake-${suffix}`,
      category: category._id,
      preparationTime: 25,
      productionTime: 35,
      electricityCostPerUnit: 3,
      packagingCostPerUnit: 2,
      variants: [{ name: "Standard", quantity: 1, unit: UNITS.PIECE, price: 100 }],
    });

    const res = await request(app)
      .get(`/api/v1/products/${legacyProduct._id}`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    // 25 + 35 = 60
    assert.equal(res.body.data.product.totalTimeMinutes, 60);
  });
});
