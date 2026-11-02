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

test("Smart Bakery — Simplified Product Costing & Owner UI Regression Suite", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create test actors
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF, USER_ROLES.CUSTOMER]) {
    const user = await User.create({
      name: `Simplified Costing ${role}`,
      email: `${role.toLowerCase()}-${suffix}@simplified-costing.com`,
      password: "Password123!",
      role,
      hourlyLabourRate: 150,
      isActive: true,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  const category = await Category.create({
    name: `Costing Category ${suffix}`,
    slug: `costing-cat-${suffix}`,
  });

  const ingredient = await Ingredient.create({
    name: `Organic Flour ${suffix}`,
    slug: `organic-flour-${suffix}`,
    unit: UNITS.KILOGRAM,
  });

  const lot = await InventoryLot.create({
    ingredient: ingredient._id,
    lotNumber: `LOT-FLOUR-${suffix}`,
    originalQuantity: 500,
    remainingQuantity: 500,
    unit: UNITS.KILOGRAM,
    unitCost: 12, // ₹12 per kg
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  let createdProductId;
  let createdVariantId;
  let createdBatchId;

  t.after(async () => {
    if (createdBatchId) {
      await ProductionBatch.deleteMany({ _id: createdBatchId });
    }
    await ProductionBatch.deleteMany({ batchNumber: new RegExp(suffix) });
    await InventoryTransaction.deleteMany({ ingredient: ingredient._id });
    await InventoryLot.deleteMany({ _id: lot._id });
    if (createdProductId) {
      await Product.deleteOne({ _id: createdProductId });
      await Recipe.deleteMany({ product: createdProductId });
      await FinishedProductStock.deleteMany({ product: createdProductId });
    }
    await Category.deleteOne({ _id: category._id });
    await Ingredient.deleteOne({ _id: ingredient._id });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@simplified-costing\\.com$`) });
    await disconnectDb();
  });

  // =========================================================================
  // Test 1: Creating a product with preparation time, electricity cost per unit, and packaging cost per unit
  // =========================================================================
  await t.test("1. Create product with preparationTimePerUnit, electricityCostPerUnit, and packagingCostPerUnit", async () => {
    const payload = {
      name: `Artisan Sourdough ${suffix}`,
      category: String(category._id),
      basePrice: 85,
      preparationTimePerUnit: 30, // 30 minutes
      electricityCostPerUnit: 4.0, // ₹4.00 per unit
      packagingCostPerUnit: 3.0, // ₹3.00 per unit
      productionTime: 45,
    };

    const res = await request(app)
      .post("/api/v1/products")
      .set(auth(USER_ROLES.OWNER))
      .send(payload);

    assert.equal(res.status, 201, res.body.message);
    const prod = res.body.data.product;
    createdProductId = prod._id;
    assert.equal(prod.preparationTimePerUnit, 30);
    assert.equal(prod.electricityCostPerUnit, 4.0);
    assert.equal(prod.packagingCostPerUnit, 3.0);

    // Add variant
    const variantRes = await request(app)
      .post(`/api/v1/products/${createdProductId}/variants`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        name: "Standard Loaf",
        quantity: 1,
        unit: "piece",
        price: 85,
      });
    assert.equal(variantRes.status, 201);
    createdVariantId = variantRes.body.data.variant._id;

    // Update the recipe: 10kg flour produces 10 loaves (so 1kg flour per loaf = ₹12 ingredient cost)
    await Recipe.findOneAndUpdate(
      { product: createdProductId, variant: createdVariantId },
      {
        $set: {
          ingredients: [{ ingredient: ingredient._id, quantity: 10, unit: UNITS.KILOGRAM }],
          expectedYield: 10,
          yieldUnit: UNITS.PIECE,
          preparationTime: 30,
          productionTime: 45,
          isActive: true,
        },
      },
      { upsert: true, new: true }
    );
  });

  // =========================================================================
  // Test 2: Editing a product and persisting updated values
  // =========================================================================
  await t.test("2. Edit product and verify persisted updated costing settings", async () => {
    const updatePayload = {
      preparationTimePerUnit: 35,
      electricityCostPerUnit: 4.5,
      packagingCostPerUnit: 3.5,
    };

    const res = await request(app)
      .patch(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER))
      .send(updatePayload);

    assert.equal(res.status, 200, res.body.message);
    const updated = res.body.data.product;
    assert.equal(updated.preparationTimePerUnit, 35);
    assert.equal(updated.electricityCostPerUnit, 4.5);
    assert.equal(updated.packagingCostPerUnit, 3.5);

    // Verify retrieval by ID retains exact updated values
    const fetchRes = await request(app)
      .get(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER));
    assert.equal(fetchRes.status, 200);
    const fetched = fetchRes.body.data.product;
    assert.equal(fetched.preparationTimePerUnit, 35);
    assert.equal(fetched.electricityCostPerUnit, 4.5);
    assert.equal(fetched.packagingCostPerUnit, 3.5);

    // Reset back to example test values (₹4.00 electricity, ₹3.00 packaging)
    await request(app)
      .patch(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        preparationTimePerUnit: 30,
        electricityCostPerUnit: 4.0,
        packagingCostPerUnit: 3.0,
      });
  });

  // =========================================================================
  // Test 3: Validating negative, non-numeric, or invalid values
  // =========================================================================
  await t.test("3. Reject negative, non-numeric, or invalid costing values", async () => {
    // Negative electricity cost
    const negElec = await request(app)
      .patch(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER))
      .send({ electricityCostPerUnit: -1 });
    assert.equal(negElec.status, 400);

    // Negative packaging cost
    const negPack = await request(app)
      .patch(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER))
      .send({ packagingCostPerUnit: -5 });
    assert.equal(negPack.status, 400);

    // Negative preparation time
    const negPrep = await request(app)
      .patch(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER))
      .send({ preparationTimePerUnit: -10 });
    assert.equal(negPrep.status, 400);

    // Non-numeric electricity cost
    const strElec = await request(app)
      .patch(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER))
      .send({ electricityCostPerUnit: "four_rupees" });
    assert.equal(strElec.status, 400);
  });

  // =========================================================================
  // Test 4: Legacy products with missing electricity and packaging fields default to ₹0
  // =========================================================================
  await t.test("4. Legacy products with missing electricity and packaging default to ₹0 without errors", async () => {
    const legacyProd = await Product.create({
      name: `Legacy Cinnamon Roll ${suffix}`,
      slug: `legacy-cinnamon-${suffix}`,
      category: category._id,
      variants: [{ name: "Roll", quantity: 1, unit: UNITS.PIECE, price: 50 }],
    });

    const getRes = await request(app)
      .get(`/api/v1/products/${legacyProd._id}`)
      .set(auth(USER_ROLES.OWNER));

    assert.equal(getRes.status, 200);
    const prod = getRes.body.data.product;
    assert.equal(prod.electricityCostPerUnit, 0);
    assert.equal(prod.packagingCostPerUnit, 0);
    assert.equal(prod.preparationTimePerUnit, 0);

    await Product.deleteOne({ _id: legacyProd._id });
  });

  // =========================================================================
  // Test 5, 6, 7: Batch costing verification using exact formula
  // Example from prompt:
  // Batch of 10 finished units:
  // - Ingredient cost: ₹120 (10 kg @ ₹12/kg)
  // - Electricity cost per unit: ₹4 => Total electricity = 10 × 4 = ₹40
  // - Packaging cost per unit: ₹3 => Total packaging = 10 × 3 = ₹30
  // - Total production cost: 120 + 40 + 30 = ₹190
  // - Cost per unit: 190 ÷ 10 = ₹19
  // =========================================================================
  await t.test("5-7. New batch computes exact formula: Ingredient (₹120) + Electricity (₹40) + Packaging (₹30) = ₹190, Unit Cost = ₹19", async () => {
    // Create batch
    const batchRes = await request(app)
      .post("/api/v1/production/batches")
      .set(auth(USER_ROLES.MANAGER))
      .send({
        product: String(createdProductId),
        productVariant: String(createdVariantId),
        plannedQuantity: 10,
        assignedWorkers: [{ worker: String(users[USER_ROLES.PRODUCTION_STAFF].user._id), task: "Baking" }],
      });
    assert.equal(batchRes.status, 201);
    createdBatchId = batchRes.body.data.batch._id;
    const batchNumber = batchRes.body.data.batch.batchNumber;

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
    assert.equal(acceptRes.status, 200);

    // Verify batch
    const verifyRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/verify`)
      .set(auth(USER_ROLES.MANAGER))
      .send(plan);
    assert.equal(verifyRes.status, 200);

    // Start batch
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({});
    assert.equal(startRes.status, 200);

    // Consume 10 kg of flour @ ₹12/kg = ₹120.00
    const consumeRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/consume`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({
        ingredients: [
          {
            ingredient: String(ingredient._id),
            lot: String(lot._id),
            quantity: 10,
            unit: UNITS.KILOGRAM,
          },
        ],
      });
    assert.equal(consumeRes.status, 200);

    // Complete baking: produced 10, usable 10, wastage 0
    const compRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/complete`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({
        producedQuantity: 10,
        usableQuantity: 10,
        wastageQuantity: 0,
      });
    assert.equal(compRes.status, 200);

    // Package batch: packaged 10
    const pkgRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/package`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ packagedQuantity: 10 });
    assert.equal(pkgRes.status, 200);

    // Fetch batch cost review (as Owner)
    const costRes = await request(app)
      .get(`/api/v1/production/batches/${createdBatchId}/cost`)
      .set(auth(USER_ROLES.OWNER));
    assert.equal(costRes.status, 200);
    const cost = costRes.body.data.cost;

    // Verify 5: Correct total electricity cost for batch (10 * ₹4.00 = ₹40.00)
    assert.equal(cost.electricityCost, 40, "Electricity cost must be Q × electricityCostPerUnit (10 × 4 = 40)");

    // Verify 6: Correct total packaging cost for batch (10 * ₹3.00 = ₹30.00)
    assert.equal(cost.packagingCost, 30, "Packaging cost must be Q × packagingCostPerUnit (10 × 3 = 30)");

    // Verify 7: Correct total production cost and cost per finished unit
    // Ingredient: ₹120.00
    // Total Production Cost: 120 + 40 + 30 = ₹190.00
    // Cost per finished unit: 190 ÷ 10 = ₹19.00
    assert.equal(cost.ingredientCost, 120, "Ingredient cost must be ₹120.00");
    assert.equal(cost.totalCost, 190, "Total production cost must be exactly ₹190.00");
    assert.equal(cost.costPerUnit, 19, "Cost per finished unit must be exactly ₹19.00");
    assert.equal(cost.costPerUsableItem, 19, "Cost per usable item must match ₹19.00");
    assert.equal(cost.actualFinishedQuantity, 10, "Actual finished quantity must be 10");

    // Labour cost must be 0 in the new formula
    assert.equal(cost.labourCost, 0, "Labour cost must be 0 in the new formula");
  });

  // =========================================================================
  // Test 8: Zero finished quantity handling (no division by zero)
  // =========================================================================
  await t.test("8. Zero finished quantity does not divide by zero and reports unavailable cost per unit", async () => {
    // Create batch that yielded 0 usable units
    const zeroBatchRes = await request(app)
      .post("/api/v1/production/batches")
      .set(auth(USER_ROLES.MANAGER))
      .send({
        product: String(createdProductId),
        productVariant: String(createdVariantId),
        plannedQuantity: 10,
      });
    const zeroBatchId = zeroBatchRes.body.data.batch._id;

    // Directly set batch with 0 produced/usable quantity
    await ProductionBatch.updateOne(
      { _id: zeroBatchId },
      {
        $set: {
          status: "COMPLETED",
          producedQuantity: 0,
          usableQuantity: 0,
          wastageQuantity: 0,
          consumedIngredients: [
            {
              ingredient: ingredient._id,
              ingredientName: ingredient.name,
              lot: lot._id,
              lotNumber: lot.lotNumber,
              quantity: 1,
              unit: UNITS.KILOGRAM,
              unitCostSnapshot: 12,
            },
          ],
        },
      }
    );

    const costRes = await request(app)
      .get(`/api/v1/production/batches/${zeroBatchId}/cost`)
      .set(auth(USER_ROLES.OWNER));
    assert.equal(costRes.status, 200);
    const cost = costRes.body.data.cost;

    assert.equal(cost.costPerUnit, null, "Cost per unit must be null when quantity is zero");
    assert.equal(cost.costPerUsableItemStatus, "UNAVAILABLE", "Status must be UNAVAILABLE");

    await ProductionBatch.deleteOne({ _id: zeroBatchId });
  });

  // =========================================================================
  // Test 9: Prevention of double-counting electricity and packaging
  // =========================================================================
  await t.test("9. Prevent duplicate or double-counting of electricity and packaging costs", async () => {
    // Attempting to re-finalize an already finalized batch returns 409
    const finalizeRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/cost/finalize`)
      .set(auth(USER_ROLES.OWNER))
      .send({});
    assert.equal(finalizeRes.status, 409, "Already finalized batch cannot be re-finalized");

    // Fetch finalized batch cost review
    const costRes = await request(app)
      .get(`/api/v1/production/batches/${createdBatchId}/cost`)
      .set(auth(USER_ROLES.OWNER));
    assert.equal(costRes.status, 200);

    const finalizedCost = costRes.body.data.cost;
    assert.equal(finalizedCost.status, "FINALIZED");
    assert.equal(finalizedCost.electricityCost, 40, "Electricity cost must not double upon finalization");
    assert.equal(finalizedCost.packagingCost, 30, "Packaging cost must not double upon finalization");
    assert.equal(finalizedCost.totalCost, 190, "Total cost remains strictly ₹190.00");
  });

  // =========================================================================
  // Test 10: Preservation of finalized historical costing snapshots
  // =========================================================================
  await t.test("10. Changing product costing settings does NOT alter finalized historical batches", async () => {
    // Owner changes product electricity cost to ₹10 and packaging cost to ₹8
    await request(app)
      .patch(`/api/v1/products/${createdProductId}`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        electricityCostPerUnit: 10.0,
        packagingCostPerUnit: 8.0,
      });

    // Re-inspect the previously finalized batch
    const costRes = await request(app)
      .get(`/api/v1/production/batches/${createdBatchId}/cost`)
      .set(auth(USER_ROLES.OWNER));
    assert.equal(costRes.status, 200);
    const cost = costRes.body.data.cost;

    assert.equal(cost.electricityCost, 40, "Historical finalized batch electricity cost must remain ₹40");
    assert.equal(cost.packagingCost, 30, "Historical finalized batch packaging cost must remain ₹30");
    assert.equal(cost.totalCost, 190, "Historical finalized batch total cost must remain ₹190");
    assert.equal(cost.costPerUnit, 19, "Historical finalized batch unit cost must remain ₹19");
  });

  // =========================================================================
  // Test 11: Owner-side cost breakdown displaying only requested components
  // =========================================================================
  await t.test("11. Owner-side cost breakdown returns all 6 requested fields and no labour/wattage/runtime cost components", async () => {
    const costRes = await request(app)
      .get(`/api/v1/production/batches/${createdBatchId}/cost`)
      .set(auth(USER_ROLES.OWNER));
    assert.equal(costRes.status, 200);
    const cost = costRes.body.data.cost;

    // The 6 required fields:
    assert.ok("ingredientCost" in cost, "Must include ingredientCost");
    assert.ok("electricityCost" in cost, "Must include electricityCost");
    assert.ok("packagingCost" in cost, "Must include packagingCost");
    assert.ok("totalCost" in cost, "Must include totalCost");
    assert.ok("actualFinishedQuantity" in cost, "Must include actualFinishedQuantity");
    assert.ok("costPerUnit" in cost, "Must include costPerUnit");

    // Value checks
    assert.equal(cost.ingredientCost, 120);
    assert.equal(cost.electricityCost, 40);
    assert.equal(cost.packagingCost, 30);
    assert.equal(cost.totalCost, 190);
    assert.equal(cost.actualFinishedQuantity, 10);
    assert.equal(cost.costPerUnit, 19);

    // Labour cost is 0
    assert.equal(cost.labourCost, 0, "Labour cost is not included in new formula totals");
  });

  // =========================================================================
  // Test 12: Baker workstation no longer requiring a timer
  // =========================================================================
  await t.test("12. Baker workstation proceeds without timer duration or elapsed tracking requirements", async () => {
    const batch2Res = await request(app)
      .post("/api/v1/production/batches")
      .set(auth(USER_ROLES.MANAGER))
      .send({
        product: String(createdProductId),
        productVariant: String(createdVariantId),
        plannedQuantity: 5,
        assignedWorkers: [{ worker: String(users[USER_ROLES.PRODUCTION_STAFF].user._id) }],
      });
    const batch2Id = batch2Res.body.data.batch._id;
    const batch2Num = batch2Res.body.data.batch.batchNumber;

    const plan = {
      batchNumber: batch2Num,
      product: String(createdProductId),
      plannedQuantity: 5,
      relatedOrders: [],
      assignedWorkers: [String(users[USER_ROLES.PRODUCTION_STAFF].user._id)],
    };

    // Accept
    const acc = await request(app)
      .post(`/api/v1/production/batches/${batch2Id}/accept`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send(plan);
    assert.equal(acc.status, 200);

    // Verify
    const ver = await request(app)
      .post(`/api/v1/production/batches/${batch2Id}/verify`)
      .set(auth(USER_ROLES.MANAGER))
      .send(plan);
    assert.equal(ver.status, 200);

    // Start without timer
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${batch2Id}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({});
    assert.equal(startRes.status, 200);

    // Consume
    const con = await request(app)
      .post(`/api/v1/production/batches/${batch2Id}/consume`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({
        ingredients: [{ ingredient: String(ingredient._id), lot: String(lot._id), quantity: 5, unit: UNITS.KILOGRAM }],
      });
    assert.equal(con.status, 200);

    // Complete immediately without any elapsed timer tracking
    const compRes = await request(app)
      .post(`/api/v1/production/batches/${batch2Id}/complete`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ producedQuantity: 5, usableQuantity: 5, wastageQuantity: 0 });
    assert.equal(compRes.status, 200);

    // Package without timer
    const pkgRes = await request(app)
      .post(`/api/v1/production/batches/${batch2Id}/package`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ packagedQuantity: 5 });
    assert.equal(pkgRes.status, 200);

    await ProductionBatch.deleteOne({ _id: batch2Id });
  });

  // =========================================================================
  // Test 13: Existing production workflow and role permissions remain intact
  // =========================================================================
  await t.test("13. Production workflow and role permissions remain strictly enforced", async () => {
    // Non-owners (Customer, Staff) cannot access cost breakdown
    const custRes = await request(app)
      .get(`/api/v1/production/batches/${createdBatchId}/cost`)
      .set(auth(USER_ROLES.CUSTOMER));
    assert.equal(custRes.status, 403, "Customer cannot access costing");

    const staffRes = await request(app)
      .get(`/api/v1/production/batches/${createdBatchId}/cost`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(staffRes.status, 403, "Production staff cannot access costing");

    // Customer cannot create or edit products
    const custProd = await request(app)
      .post("/api/v1/products")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({ name: "Hacked Product", category: String(category._id) });
    assert.equal(custProd.status, 403);
  });
});
