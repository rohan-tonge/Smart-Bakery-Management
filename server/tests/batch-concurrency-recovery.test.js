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
import { USER_ROLES, PRODUCTION_STATUS as S } from "../src/utils/constants.js";

test("Production Worker Concurrency and Manager Abandoned Batch Recovery Suite", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // 1. Create test users
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF]) {
    const user = await User.create({
      name: `Concurrency Test ${role}`,
      email: `${role.toLowerCase()}-${suffix}@concurrency-test.com`,
      password: "Password123!",
      role,
      hourlyLabourRate: 150,
      isActive: true,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }

  // Second production staff member
  const staff2 = await User.create({
    name: `Worker Two ${suffix}`,
    email: `staff2-${suffix}@concurrency-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    hourlyLabourRate: 160,
    isActive: true,
  });
  users.STAFF_2 = { user: staff2, token: generateAccessToken(staff2) };

  // Third production staff member (for race condition tests)
  const staff3 = await User.create({
    name: `Worker Three ${suffix}`,
    email: `staff3-${suffix}@concurrency-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    hourlyLabourRate: 140,
    isActive: true,
  });
  users.STAFF_3 = { user: staff3, token: generateAccessToken(staff3) };

  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  // 2. Fixtures: Category, Product, Recipe
  const category = await Category.create({
    name: `Concurrency Cat ${suffix}`,
    slug: `concurrency-cat-${suffix}`,
  });
  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Concurrency Cake ${suffix}`,
    slug: `cake-${suffix}`,
    category: category._id,
    variants: [{ _id: variantId, name: "1kg", quantity: 1, unit: "piece", price: 300, isActive: true }],
  });

  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    name: `Cake Recipe ${suffix}`,
    expectedYield: 10,
    yieldUnit: "piece",
    batchQuantity: 1,
    preparationTime: 10,
    productionTime: 20,
    estimatedDurationMinutes: 30,
    equipmentPowerKw: 2.5,
    electricityTariff: 8.5,
    packagingMaterials: [
      { name: "Standard Box", costPerUnit: 5, consumptionType: "PER_PIECE", unitsPerItem: 1 },
    ],
    ingredients: [],
  });

  const createdBatchIds = [];

  // Helper to create a verified batch assigned to a worker
  let batchCounter = 1;
  const createVerifiedBatch = async (workerUser) => {
    const batchNum = `BATCH-TEST-${suffix}-${batchCounter++}`;
    const batch = await ProductionBatch.create({
      batchNumber: batchNum,
      product: product._id,
      productVariant: variantId,
      productSnapshot: {
        productName: product.name,
        variantName: "1kg",
        variantQuantity: 1,
        variantUnit: "piece",
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 10,
        yieldUnit: "piece",
        recipeBatchQuantity: 1,
        preparationTime: 10,
        productionTime: 20,
        estimatedDurationMinutes: 30,
        equipmentPowerKw: 2.5,
        electricityTariff: 8.5,
        packagingMaterials: [
          { name: "Standard Box", costPerUnit: 5, consumptionType: "PER_PIECE", unitsPerItem: 1 },
        ],
        ingredients: [],
      },
      plannedQuantity: 10,
      estimatedDurationMinutes: 30,
      unit: "piece",
      status: S.VERIFIED,
      verificationStatus: "VERIFIED",
      consumptionStatus: "CONSUMED",
      verifiedBy: users[USER_ROLES.OWNER].user._id,
      verifiedAt: new Date(),
      assignedWorkers: [
        {
          worker: workerUser._id,
          task: "Baking",
          taskStatus: "PENDING",
          hourlyRateSnapshot: workerUser.hourlyLabourRate || 150,
          actualHours: null,
        },
      ],
      createdBy: users[USER_ROLES.OWNER].user._id,
    });
    createdBatchIds.push(batch._id);
    return batch;
  };

  t.after(async () => {
    try {
      if (createdBatchIds.length) {
        await ProductionBatch.deleteMany({ _id: { $in: createdBatchIds } });
        await FinishedProductStock.deleteMany({ product: product._id });
      }
      await Recipe.deleteOne({ _id: recipe._id });
      await Product.deleteOne({ _id: product._id });
      await Category.deleteOne({ _id: category._id });
      await User.deleteMany({ email: new RegExp(`${suffix}\\@concurrency-test\\.com$`) });
    } catch {}
    await disconnectDb();
  });

  await t.test("1. Worker with an active IN_PRODUCTION batch cannot start a second batch", async () => {
    const worker = users[USER_ROLES.PRODUCTION_STAFF].user;
    const batchA = await createVerifiedBatch(worker);
    const batchB = await createVerifiedBatch(worker);

    // Start batch A
    const resA = await request(app)
      .post(`/api/v1/production/batches/${batchA._id}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    if (resA.status !== 200) console.log("resA error:", resA.status, resA.body);
    assert.equal(resA.status, 200);
    assert.equal(resA.body.data.batch.status, "IN_PRODUCTION");

    // Attempt to start batch B with same worker -> must fail 409
    const resB = await request(app)
      .post(`/api/v1/production/batches/${batchB._id}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    if (resB.status !== 409) console.log("resB error:", resB.status, resB.body);
    assert.equal(resB.status, 409);
    assert.match(resB.body.message, /already has an actively running production batch/);
    assert.match(resB.body.message, new RegExp(batchA.batchNumber));
    assert.match(resB.body.message, /Concurrency policy strictly limits each staff member to one active batch/);
  });

  await t.test("2. Worker with an active PACKAGING batch cannot start a second batch", async () => {
    const worker = users[USER_ROLES.PRODUCTION_STAFF].user;
    // Find active batch A from previous test and advance to PACKAGING via complete
    const running = await ProductionBatch.findOne({
      "assignedWorkers.worker": worker._id,
      status: S.IN_PRODUCTION,
    });
    assert.ok(running, "Expected running batch from test 1");

    // Staff completes baking -> moves to PACKAGING
    const compRes = await request(app)
      .post(`/api/v1/production/batches/${running._id}/complete`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ producedQuantity: 10, usableQuantity: 10, wastageQuantity: 0, equipmentRuntimeMinutes: 30 });
    assert.equal(compRes.status, 200);
    assert.equal(compRes.body.data.batch.status, "PACKAGING");

    // Create a new verified batch C for this worker
    const batchC = await createVerifiedBatch(worker);

    // Attempt to start batch C -> must still fail 409 because PACKAGING is an active state
    const resC = await request(app)
      .post(`/api/v1/production/batches/${batchC._id}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(resC.status, 409);
    assert.match(resC.body.message, /already has an actively running production batch/);
  });

  await t.test("3. Two different workers can run active batches simultaneously without false conflict", async () => {
    const worker2 = users.STAFF_2.user;
    const batchD = await createVerifiedBatch(worker2);

    // Worker 2 starts batch D -> should succeed even though Worker 1 has an active batch in PACKAGING
    const resD = await request(app)
      .post(`/api/v1/production/batches/${batchD._id}/start`)
      .set(auth("STAFF_2"));
    assert.equal(resD.status, 200);
    assert.equal(resD.body.data.batch.status, "IN_PRODUCTION");
    assert.equal(resD.body.data.batch.assignedWorkers[0].taskStatus, "IN_PROGRESS");
  });

  await t.test("4. When an active batch reaches terminal state (COMPLETED), worker is immediately unblocked", async () => {
    const worker2 = users.STAFF_2.user;
    const activeBatch = await ProductionBatch.findOne({
      "assignedWorkers.worker": worker2._id,
      status: S.IN_PRODUCTION,
    });
    assert.ok(activeBatch);

    // Complete baking
    await request(app)
      .post(`/api/v1/production/batches/${activeBatch._id}/complete`)
      .set(auth("STAFF_2"))
      .send({ producedQuantity: 10, usableQuantity: 10, wastageQuantity: 0, equipmentRuntimeMinutes: 30 });

    // Package batch
    await request(app)
      .post(`/api/v1/production/batches/${activeBatch._id}/package`)
      .set(auth("STAFF_2"))
      .send({
        packagedQuantity: 10,
        materialsUsed: [{ name: "Standard Box", quantityUsed: 10, costPerUnit: 5 }],
      });

    // Finalize to terminal COMPLETED
    const finRes = await request(app)
      .post(`/api/v1/production/batches/${activeBatch._id}/finalize`)
      .set(auth("STAFF_2"));
    assert.equal(finRes.status, 200);
    assert.equal(finRes.body.data.batch.status, "COMPLETED");

    // Worker 2 can now immediately start another verified batch
    const nextBatch = await createVerifiedBatch(worker2);
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${nextBatch._id}/start`)
      .set(auth("STAFF_2"));
    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.data.batch.status, "IN_PRODUCTION");
  });

  await t.test("5. Authorized manager can cancel an abandoned IN_PRODUCTION batch", async () => {
    const worker3 = users.STAFF_3.user;
    const abandonedBatch = await createVerifiedBatch(worker3);

    // Worker 3 starts the batch
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${abandonedBatch._id}/start`)
      .set(auth("STAFF_3"));
    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.data.batch.status, "IN_PRODUCTION");

    // Manager cancels the abandoned batch
    const cancelRes = await request(app)
      .post(`/api/v1/production/batches/${abandonedBatch._id}/cancel`)
      .set(auth(USER_ROLES.MANAGER))
      .send({ reason: "Worker fell sick; reconciling abandoned production batch" });

    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.data.batch.status, "CANCELLED");
    assert.equal(cancelRes.body.data.batch.cancellationReason, "Worker fell sick; reconciling abandoned production batch");
    assert.equal(cancelRes.body.data.batch.cancelledBy, String(users[USER_ROLES.MANAGER].user._id));
    assert.ok(cancelRes.body.data.batch.cancelledAt);

    // Verify assigned worker task status is updated to CANCELLED in DB
    const dbBatch = await ProductionBatch.findById(abandonedBatch._id);
    assert.equal(dbBatch.status, "CANCELLED");
    assert.equal(dbBatch.assignedWorkers[0].taskStatus, "CANCELLED");
  });

  await t.test("6. Authorized manager can cancel an abandoned PACKAGING batch", async () => {
    const worker = users[USER_ROLES.PRODUCTION_STAFF].user;
    // Worker 1 currently has a batch in PACKAGING from test 2
    const packagingBatch = await ProductionBatch.findOne({
      "assignedWorkers.worker": worker._id,
      status: S.PACKAGING,
    });
    assert.ok(packagingBatch);

    const cancelRes = await request(app)
      .post(`/api/v1/production/batches/${packagingBatch._id}/cancel`)
      .set(auth(USER_ROLES.OWNER))
      .send({ reason: "Packaging material defect; cancelled by owner" });

    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.data.batch.status, "CANCELLED");

    const dbBatch = await ProductionBatch.findById(packagingBatch._id);
    assert.equal(dbBatch.status, "CANCELLED");
    assert.equal(dbBatch.assignedWorkers[0].taskStatus, "CANCELLED");
  });

  await t.test("7. Once cancelled, the assigned worker is immediately unblocked and can start next batch", async () => {
    const worker = users[USER_ROLES.PRODUCTION_STAFF].user;
    // Worker 1's active packaging batch was cancelled in test 6.
    // Create new batch for Worker 1
    const unblockedBatch = await createVerifiedBatch(worker);

    const startRes = await request(app)
      .post(`/api/v1/production/batches/${unblockedBatch._id}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF));

    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.data.batch.status, "IN_PRODUCTION");
  });

  await t.test("8. Concurrent start race condition: exactly one succeeds and one fails with 409", async () => {
    const worker3 = users.STAFF_3.user;
    // Worker 3's previous batch was cancelled in test 5, so worker 3 has 0 active batches.
    const raceBatch1 = await createVerifiedBatch(worker3);
    const raceBatch2 = await createVerifiedBatch(worker3);

    // Fire both start requests concurrently
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/production/batches/${raceBatch1._id}/start`)
        .set(auth("STAFF_3")),
      request(app)
        .post(`/api/v1/production/batches/${raceBatch2._id}/start`)
        .set(auth("STAFF_3")),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409], "Expected exactly one 200 OK and one 409 Conflict");

    const conflictRes = res1.status === 409 ? res1 : res2;
    assert.match(conflictRes.body.message, /already has an actively running production batch/);

    // Verify in database: exactly ONE batch is in IN_PRODUCTION for worker 3
    const activeCount = await ProductionBatch.countDocuments({
      _id: { $in: [raceBatch1._id, raceBatch2._id] },
      status: S.IN_PRODUCTION,
    });
    assert.equal(activeCount, 1, "Exactly one batch must be IN_PRODUCTION");
  });

  await t.test("9. Unauthorized production staff cannot cancel a batch", async () => {
    const worker = users[USER_ROLES.PRODUCTION_STAFF].user;
    const batch = await createVerifiedBatch(worker);

    const res = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/cancel`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({ reason: "I want to cancel" });

    assert.equal(res.status, 403, "Production staff must be forbidden from cancelling batches");
  });

  await t.test("10. Terminal batches (COMPLETED / CANCELLED) cannot be cancelled again", async () => {
    const worker = users[USER_ROLES.PRODUCTION_STAFF].user;
    const batch = await createVerifiedBatch(worker);

    // Cancel once
    const cancelRes1 = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/cancel`)
      .set(auth(USER_ROLES.OWNER));
    assert.equal(cancelRes1.status, 200);

    // Attempt to cancel again -> 409 Conflict
    const cancelRes2 = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/cancel`)
      .set(auth(USER_ROLES.OWNER));
    assert.equal(cancelRes2.status, 409);
    assert.match(cancelRes2.body.message, /Invalid production status transition to CANCELLED/);
  });
});
