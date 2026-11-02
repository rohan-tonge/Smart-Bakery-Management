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
import Order from "../src/models/order.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";

test("Completely Removed Quality Check (QC) Regression & Production Workflow Suite", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF, USER_ROLES.CUSTOMER]) {
    const user = await User.create({
      name: `QC Removal ${role}`,
      email: `${role.toLowerCase()}-${suffix}@qcremoval-test.com`,
      password: "Password123!",
      role,
      hourlyLabourRate: 150,
      isActive: true,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  const category = await Category.create({ name: `QC Bakery ${suffix}`, slug: `qc-bakery-${suffix}` });
  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Artisan Croissant ${suffix}`,
    slug: `croissant-${suffix}`,
    category: category._id,
    variants: [{ _id: variantId, name: "Butter Croissant", quantity: 1, unit: "piece", price: 65, isActive: true }],
    preparationTimePerUnit: 30,
    electricityCostPerUnit: 3.375,
    packagingCostPerUnit: 2.0,
  });

  const ingredient = await Ingredient.create({ name: `Butter ${suffix}`, slug: `butter-${suffix}`, unit: "kg" });
  const lot = await InventoryLot.create({
    ingredient: ingredient._id,
    lotNumber: `LOT-BUTTER-${suffix}`,
    originalQuantity: 50,
    remainingQuantity: 50,
    unit: "kg",
    unitCost: 120, // ₹120/kg
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    ingredients: [{ ingredient: ingredient._id, quantity: 2, unit: "kg" }],
    expectedYield: 20,
    yieldUnit: "piece",
    preparationTime: 30,
    productionTime: 45,
    powerMinutes: 45,
    powerCostPerMinute: 1.5, // 45 * 1.5 = ₹67.50
    packagingCostPerUnit: 2.0, // 20 * 2.0 = ₹40.00
  });

  let createdBatchId;
  let createdBatchNumber;

  t.after(async () => {
    if (createdBatchId) {
      await ProductionBatch.deleteMany({ _id: createdBatchId });
    }
    await InventoryTransaction.deleteMany({ ingredient: ingredient._id });
    await InventoryLot.deleteMany({ ingredient: ingredient._id });
    await FinishedProductStock.deleteMany({ product: product._id });
    await Recipe.deleteOne({ _id: recipe._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await Ingredient.deleteOne({ _id: ingredient._id });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@qcremoval-test\\.com$`) });
    await disconnectDb();
  });

  // 1. Verify QC endpoint is completely removed
  await t.test("QC-only endpoint /batches/:id/quality-check returns 404 Not Found", async () => {
    const dummyId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post(`/api/v1/production/batches/${dummyId}/quality-check`)
      .set(auth(USER_ROLES.OWNER))
      .send({ result: "PASS", notes: "Test" });
    assert.equal(res.status, 404, "Endpoint must not exist");
  });

  // 2. Production batch creation and assignment
  await t.test("Batch creation and verification proceed without any QC configuration", async () => {
    const res = await request(app)
      .post("/api/v1/production/batches")
      .set(auth(USER_ROLES.MANAGER))
      .send({
        product: String(product._id),
        productVariant: String(variantId),
        plannedQuantity: 20,
        assignedWorkers: [{ worker: String(users[USER_ROLES.PRODUCTION_STAFF].user._id), task: "Baking" }],
      });
    assert.equal(res.status, 201);
    createdBatchId = res.body.data.batch._id;
    createdBatchNumber = res.body.data.batch.batchNumber;
    assert.equal(res.body.data.batch.status, "PLANNED");

    // Staff accepts
    const plan = {
      batchNumber: createdBatchNumber,
      product: String(product._id),
      plannedQuantity: 20,
      relatedOrders: [],
      assignedWorkers: [String(users[USER_ROLES.PRODUCTION_STAFF].user._id)],
    };
    const accept = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/accept`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send(plan);
    assert.equal(accept.status, 200);

    // Manager verifies ingredients
    const verify = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/verify`)
      .set(auth(USER_ROLES.MANAGER))
      .send(plan);
    assert.equal(verify.status, 200);
    assert.equal(verify.body.data.batch.status, "VERIFIED");
  });

  // 3. Inventory issue, consumption, and idempotency
  await t.test("Inventory consumption records lot deduction and prevents duplicate deductions", async () => {
    // Start production
    const start = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(start.status, 200);
    assert.equal(start.body.data.batch.status, "IN_PRODUCTION");

    // Consume ingredients
    const consume = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/consume`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(consume.status, 200);
    assert.equal(consume.body.data.batch.consumptionStatus, "CONSUMED");

    // Verify inventory deduction: 2 kg consumed from 50 kg lot -> 48 kg remaining
    const lotDoc = await InventoryLot.findById(lot._id);
    assert.equal(lotDoc.remainingQuantity, 48);

    // Repeated consumption request must return 409 and NOT double-deduct
    const repeatConsume = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/consume`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(repeatConsume.status, 409);
    const lotDocAfter = await InventoryLot.findById(lot._id);
    assert.equal(lotDocAfter.remainingQuantity, 48, "Remaining inventory must not change on duplicate consume");
  });

  // 4. Actual hours recording and oven completion (transitions directly to PACKAGING)
  await t.test("Baking completion transitions directly to PACKAGING with no QC requirement", async () => {
    // Record staff hours (1.5 hours @ 150/hr = ₹225.00)
    const hoursRes = await request(app)
      .patch(`/api/v1/workers/batches/${createdBatchId}/assignment`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ actualHours: 1.5 });
    assert.equal(hoursRes.status, 200);

    // Complete baking
    const complete = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/complete`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({
        producedQuantity: 20,
        usableQuantity: 20,
        wastageQuantity: 0,
        productionNotes: "Flaky golden croissants",
      });
    assert.equal(complete.status, 200);
    assert.equal(complete.body.message, "Baking output recorded successfully; batch ready for packaging");
    // CRITICAL: status moves directly to PACKAGING (not QUALITY_CHECK)
    assert.equal(complete.body.data.batch.status, "PACKAGING");
    assert.equal(complete.body.data.batch.completionStatus, "DONE");
  });

  // 5. Packaging and automatic costing finalization
  await t.test("Packaging completes without QC and triggers automatic costing finalization", async () => {
    // Package batch
    const pkg = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/package`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ packagedQuantity: 20 });
    assert.equal(pkg.status, 200);
    assert.equal(pkg.body.data.batch.status, "PACKAGED");
    assert.equal(pkg.body.data.batch.packagingStatus, "DONE");

    // Finished stock updated
    const stock = await FinishedProductStock.findOne({ product: product._id, variant: variantId });
    assert.ok(stock);
    assert.equal(stock.onHandQuantity, 20);

    // Repeated packaging must return 409 and NOT double-add stock
    const repeatPkg = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/package`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ packagedQuantity: 20 });
    assert.equal(repeatPkg.status, 409);
    const stockAfter = await FinishedProductStock.findOne({ product: product._id, variant: variantId });
    assert.equal(stockAfter.onHandQuantity, 20, "Finished stock must not be duplicated on replay");

    // Check costing was automatically finalized upon packaging completion:
    // Ingredient Cost: 2 kg @ 120/kg = 240.00 rupees = 24000 paise
    // Labour Cost: 0 (new simplified costing excludes labour)
    // Packaging Cost: 20 units * 2.0 = 40.00 rupees = 4000 paise
    // Electricity Cost: 20 units * 3.375 = 67.50 rupees = 6750 paise
    // Total Cost: 24000 + 4000 + 6750 = 34750 paise = ₹347.50
    const batchDoc = await ProductionBatch.findById(createdBatchId);
    assert.equal(batchDoc.costing.status, "FINALIZED", "Costing must be automatically finalized without QC");
    assert.equal(batchDoc.costing.ingredientCostPaise, 24000);
    assert.equal(batchDoc.costing.labourCostPaise, 0);
    assert.equal(batchDoc.costing.packagingCostPaise, 4000);
    assert.equal(batchDoc.costing.electricityCostPaise, 6750);
    assert.equal(batchDoc.costing.totalCostPaise, 34750);
    assert.ok(batchDoc.costing.finalizedAt);
  });

  // 6. Complete and deliver workflow
  await t.test("Batch finalizes to COMPLETED and DELIVERED seamlessly", async () => {
    const finalize = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/finalize`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(finalize.status, 200);
    assert.equal(finalize.body.data.batch.status, "COMPLETED");

    const deliver = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/deliver`)
      .set(auth(USER_ROLES.MANAGER));
    assert.equal(deliver.status, 200);
    assert.equal(deliver.body.data.batch.status, "DELIVERED");
  });

  // 7. Security and RBAC controls preserved
  await t.test("Customer cannot access production or costing endpoints", async () => {
    assert.equal(
      (await request(app).get(`/api/v1/production/batches/${createdBatchId}/cost`).set(auth(USER_ROLES.CUSTOMER))).status,
      403,
    );
    assert.equal(
      (await request(app).post(`/api/v1/production/batches/${createdBatchId}/package`).set(auth(USER_ROLES.CUSTOMER))).status,
      403,
    );
  });

  // 8. Historical records preservation
  await t.test("Historical database records and existing finalized costs are preserved", async () => {
    const batch = await ProductionBatch.findById(createdBatchId);
    assert.ok(batch, "Batch in database must remain intact");
    assert.equal(batch.costing?.status, "FINALIZED", "Finalized batch must retain its finalized costing status");
    assert.ok(Number(batch.costing?.totalCostPaise) > 0, "Cost calculations are preserved");
  });
});
