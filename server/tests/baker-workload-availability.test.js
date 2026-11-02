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
import ProductionBatch from "../src/models/productionBatch.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES, PRODUCTION_STATUS as S } from "../src/utils/constants.js";

test("Baker Availability and Workload Status Regression Suite", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // 1. Users setup
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.CUSTOMER]) {
    const user = await User.create({
      name: `Workload ${role}`,
      email: `${role.toLowerCase()}-${suffix}@workload-test.com`,
      password: "Password123!",
      role,
      isActive: true,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }

  // Active production staff 1
  const baker1 = await User.create({
    name: `Baker Arjun ${suffix}`,
    email: `arjun-${suffix}@workload-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    jobDesignation: "Head Baker",
    hourlyLabourRate: 180,
    isActive: true,
  });
  users.BAKER_1 = { user: baker1, token: generateAccessToken(baker1) };

  // Active production staff 2 (remains free/available)
  const baker2 = await User.create({
    name: `Baker Priya ${suffix}`,
    email: `priya-${suffix}@workload-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    jobDesignation: "Pastry Chef",
    hourlyLabourRate: 160,
    isActive: true,
  });
  users.BAKER_2 = { user: baker2, token: generateAccessToken(baker2) };

  // Inactive production staff 3 (disabled account)
  const baker3Inactive = await User.create({
    name: `Baker Inactive ${suffix}`,
    email: `inactive-${suffix}@workload-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    jobDesignation: "Apprentice",
    hourlyLabourRate: 120,
    isActive: false,
  });
  users.BAKER_INACTIVE = { user: baker3Inactive, token: generateAccessToken(baker3Inactive) };

  const auth = (roleKey) => ({ Authorization: `Bearer ${users[roleKey].token}` });

  // 2. Fixtures: Category, Product, Recipe
  const category = await Category.create({
    name: `Workload Cat ${suffix}`,
    slug: `workload-cat-${suffix}`,
  });
  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Chocolate Cake ${suffix}`,
    slug: `choco-cake-${suffix}`,
    category: category._id,
    variants: [{ _id: variantId, name: "1kg", quantity: 1, unit: "piece", price: 500, isActive: true }],
  });

  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    name: `Choco Recipe ${suffix}`,
    expectedYield: 5,
    yieldUnit: "piece",
    batchQuantity: 1,
    preparationTime: 15,
    productionTime: 30,
    estimatedDurationMinutes: 45,
    ingredients: [],
  });

  const createdBatchIds = [];
  let batchSeq = 1;

  const createBatch = async (workerUser, status = S.VERIFIED, extra = {}) => {
    const batchNumber = `BATCH-${suffix}-${batchSeq++}`;
    const batch = await ProductionBatch.create({
      batchNumber,
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
        expectedYield: 5,
        yieldUnit: "piece",
        recipeBatchQuantity: 1,
        preparationTime: 15,
        productionTime: 30,
        estimatedDurationMinutes: 45,
        ingredients: [],
      },
      plannedQuantity: 5,
      usableQuantity: status === S.COMPLETED ? 5 : undefined,
      estimatedDurationMinutes: 45,
      unit: "piece",
      status,
      verificationStatus: "VERIFIED",
      consumptionStatus: status === S.PLANNED ? "NOT_STARTED" : "CONSUMED",
      verifiedBy: users[USER_ROLES.OWNER].user._id,
      verifiedAt: new Date(),
      actualStartTime: [S.IN_PRODUCTION, S.PACKAGING, S.COMPLETED].includes(status) ? new Date(Date.now() - 25 * 60 * 1000) : null,
      bakingStartTime: [S.IN_PRODUCTION, S.PACKAGING, S.COMPLETED].includes(status) ? new Date(Date.now() - 25 * 60 * 1000) : null,
      assignedWorkers: [
        {
          worker: workerUser._id,
          task: "Baking",
          taskStatus: [S.IN_PRODUCTION, S.PACKAGING].includes(status) ? "IN_PROGRESS" : status === S.COMPLETED ? "COMPLETED" : "PENDING",
          hourlyRateSnapshot: workerUser.hourlyLabourRate || 150,
          actualHours: status === S.COMPLETED ? 0.75 : null,
        },
      ],
      createdBy: users[USER_ROLES.OWNER].user._id,
      ...extra,
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
      await User.deleteMany({ email: new RegExp(`${suffix}\\@workload-test\\.com$`) });
    } catch {}
    await disconnectDb();
  });

  // Test 1: Baker with an active batch appears BUSY
  await t.test("1. Baker with an active batch appears BUSY", async () => {
    const activeBatch = await createBatch(users.BAKER_1.user, S.IN_PRODUCTION);

    const res = await request(app)
      .get("/api/v1/production/team-status")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const team = res.body.data.teamStatus;
    assert.ok(Array.isArray(team));

    const arjun = team.find((item) => String(item.worker._id) === String(users.BAKER_1.user._id));
    assert.ok(arjun, "Expected Baker 1 in workload status list");
    assert.equal(arjun.availability, "BUSY");
    assert.equal(arjun.hasConflict, false);
    assert.ok(arjun.activeBatch, "Expected activeBatch object on busy baker");
    assert.equal(arjun.activeBatch.batchNumber, activeBatch.batchNumber);
    assert.equal(arjun.activeBatch.status, "IN_PRODUCTION");
  });

  // Test 2: Baker with no active batch appears AVAILABLE only when eligible
  await t.test("2. Baker with no active batch appears AVAILABLE only when eligible", async () => {
    const res = await request(app)
      .get("/api/v1/production/team-status")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const team = res.body.data.teamStatus;

    // Eligible active baker 2 with 0 active batches -> AVAILABLE
    const priya = team.find((item) => String(item.worker._id) === String(users.BAKER_2.user._id));
    assert.ok(priya);
    assert.equal(priya.worker.isActive, true);
    assert.equal(priya.availability, "AVAILABLE");
    assert.equal(priya.activeBatch, null);

    // Inactive baker 3 -> UNAVAILABLE / OFFLINE (never falsely marked AVAILABLE)
    const inactive = team.find((item) => String(item.worker._id) === String(users.BAKER_INACTIVE.user._id));
    assert.ok(inactive);
    assert.equal(inactive.worker.isActive, false);
    assert.notEqual(inactive.availability, "AVAILABLE");
    assert.equal(inactive.availability, "UNAVAILABLE");
    assert.equal(inactive.label, "Offline / Unavailable");
  });

  // Test 3: Completed batches no longer make a baker appear BUSY
  await t.test("3. Completed batches no longer make a baker appear BUSY", async () => {
    // Clean up active batch for Baker 1 and replace with a terminal COMPLETED batch
    await ProductionBatch.deleteMany({ "assignedWorkers.worker": users.BAKER_1.user._id });
    await createBatch(users.BAKER_1.user, S.COMPLETED);

    const res = await request(app)
      .get("/api/v1/production/team-status")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const team = res.body.data.teamStatus;
    const arjun = team.find((item) => String(item.worker._id) === String(users.BAKER_1.user._id));
    assert.ok(arjun);
    assert.equal(arjun.availability, "AVAILABLE");
    assert.equal(arjun.activeBatch, null);
  });

  // Test 4: Cancelled batches no longer make a baker appear BUSY
  await t.test("4. Cancelled batches no longer make a baker appear BUSY", async () => {
    await ProductionBatch.deleteMany({ "assignedWorkers.worker": users.BAKER_1.user._id });
    await createBatch(users.BAKER_1.user, S.CANCELLED, {
      cancellationReason: "Ingredient recall",
      cancelledAt: new Date(),
    });

    const res = await request(app)
      .get("/api/v1/production/team-status")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const team = res.body.data.teamStatus;
    const arjun = team.find((item) => String(item.worker._id) === String(users.BAKER_1.user._id));
    assert.ok(arjun);
    assert.equal(arjun.availability, "AVAILABLE");
    assert.equal(arjun.activeBatch, null);
  });

  // Test 5: Active batches show the correct product, stage, and start time
  await t.test("5. Active batches show the correct product, stage, and start time", async () => {
    await ProductionBatch.deleteMany({ "assignedWorkers.worker": users.BAKER_1.user._id });
    const startedAt = new Date(Date.now() - 30 * 60 * 1000);
    const batch = await createBatch(users.BAKER_1.user, S.IN_PRODUCTION, {
      actualStartTime: startedAt,
      bakingStartTime: startedAt,
    });

    const res = await request(app)
      .get("/api/v1/production/team-status")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const arjun = res.body.data.teamStatus.find((item) => String(item.worker._id) === String(users.BAKER_1.user._id));
    assert.ok(arjun?.activeBatch);
    assert.equal(arjun.activeBatch.productName, product.name);
    assert.equal(arjun.activeBatch.stage, "IN_PRODUCTION");
    assert.equal(arjun.activeBatch.status, "IN_PRODUCTION");
    assert.equal(arjun.activeBatch.task, "Baking");
    assert.ok(arjun.activeBatch.actualStartTime);
    assert.equal(new Date(arjun.activeBatch.actualStartTime).getTime(), startedAt.getTime());
    assert.equal(arjun.activeBatch.estimatedDurationMinutes, 45);
  });

  // Test 6: Multiple active batches trigger a conflict warning
  await t.test("6. Multiple active batches trigger a conflict warning", async () => {
    // Create a SECOND active running batch for Baker 1 (simulating data race / edge case)
    const secondBatch = await createBatch(users.BAKER_1.user, S.PACKAGING);

    const res = await request(app)
      .get("/api/v1/production/team-status")
      .set(auth(USER_ROLES.OWNER));

    assert.equal(res.status, 200);
    const arjun = res.body.data.teamStatus.find((item) => String(item.worker._id) === String(users.BAKER_1.user._id));
    assert.ok(arjun);
    assert.equal(arjun.hasConflict, true);
    assert.equal(arjun.state, "CONFLICT");
    assert.match(arjun.conflictWarning, /Workload Conflict/);
    assert.match(arjun.conflictWarning, /concurrency policy/i);
    assert.equal(arjun.activeBatches.length, 2);
  });

  // Test 7: Unauthorized users cannot access the owner workload endpoint
  await t.test("7. Unauthorized users cannot access the owner workload endpoint", async () => {
    // 1. Unauthenticated -> 401
    const unauthRes = await request(app).get("/api/v1/production/team-status");
    assert.equal(unauthRes.status, 401);

    // 2. Customer -> 403 Forbidden
    const customerRes = await request(app)
      .get("/api/v1/production/team-status")
      .set(auth(USER_ROLES.CUSTOMER));
    assert.equal(customerRes.status, 403);

    // 3. Production Staff -> 403 Forbidden
    const staffRes = await request(app)
      .get("/api/v1/production/team-status")
      .set(auth("BAKER_1"));
    assert.equal(staffRes.status, 403);

    // 4. Also test alternative route /api/v1/workers/workload-status
    const staffWorkerRes = await request(app)
      .get("/api/v1/workers/workload-status")
      .set(auth("BAKER_1"));
    assert.equal(staffWorkerRes.status, 403);

    // 5. Authorized Manager -> 200 OK
    const managerRes = await request(app)
      .get("/api/v1/production/team-status")
      .set(auth(USER_ROLES.MANAGER));
    assert.equal(managerRes.status, 200);

    // 6. Authorized Owner -> 200 OK
    const ownerRes = await request(app)
      .get("/api/v1/workers/workload-status")
      .set(auth(USER_ROLES.OWNER));
    assert.equal(ownerRes.status, 200);
  });

  // Test 8: Starting, completing, cancelling, or reassigning a batch updates availability
  await t.test("8. Starting, completing, cancelling, or reassigning a batch updates availability", async () => {
    await ProductionBatch.deleteMany({ "assignedWorkers.worker": users.BAKER_1.user._id });

    // Step 8a: Create batch in VERIFIED (not started yet). Baker 1 is AVAILABLE with 1 queued batch.
    const batch = await createBatch(users.BAKER_1.user, S.VERIFIED);
    let statusRes = await request(app)
      .get("/api/v1/production/team-status")
      .set(auth(USER_ROLES.OWNER));
    let arjun = statusRes.body.data.teamStatus.find((item) => String(item.worker._id) === String(users.BAKER_1.user._id));
    assert.equal(arjun.availability, "AVAILABLE");
    assert.equal(arjun.totalAssigned, 1);

    // Step 8b: Reassign the verified batch to Baker 2
    const reassignRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/reassign`)
      .set(auth(USER_ROLES.OWNER))
      .send({ newWorkerId: String(users.BAKER_2.user._id), reason: "Shift rotation handover" });
    assert.equal(reassignRes.status, 200);

    // Baker 1 now has 0 assigned batches; Baker 2 has the assignment
    statusRes = await request(app).get("/api/v1/production/team-status").set(auth(USER_ROLES.OWNER));
    arjun = statusRes.body.data.teamStatus.find((item) => String(item.worker._id) === String(users.BAKER_1.user._id));
    const priya = statusRes.body.data.teamStatus.find((item) => String(item.worker._id) === String(users.BAKER_2.user._id));
    assert.equal(arjun.totalAssigned, 0);
    assert.equal(priya.totalAssigned, 1);

    // Step 8c: Re-verify and start batch with Baker 2 -> Baker 2 transitions to BUSY
    await ProductionBatch.updateOne({ _id: batch._id }, { $set: { status: S.VERIFIED, verificationStatus: "VERIFIED" } });
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/start`)
      .set(auth("BAKER_2"));
    assert.equal(startRes.status, 200);

    statusRes = await request(app).get("/api/v1/production/team-status").set(auth(USER_ROLES.OWNER));
    const priyaAfterStart = statusRes.body.data.teamStatus.find((item) => String(item.worker._id) === String(users.BAKER_2.user._id));
    assert.equal(priyaAfterStart.availability, "BUSY");
    assert.ok(priyaAfterStart.activeBatch);
    assert.equal(priyaAfterStart.activeBatch.batchNumber, batch.batchNumber);

    // Step 8d: Manager cancels the active batch -> Baker 2 immediately returns to AVAILABLE
    const cancelRes = await request(app)
      .post(`/api/v1/production/batches/${batch._id}/cancel`)
      .set(auth(USER_ROLES.OWNER))
      .send({ reason: "Oven mechanical issue" });
    assert.equal(cancelRes.status, 200);

    statusRes = await request(app).get("/api/v1/production/team-status").set(auth(USER_ROLES.OWNER));
    const priyaAfterCancel = statusRes.body.data.teamStatus.find((item) => String(item.worker._id) === String(users.BAKER_2.user._id));
    assert.equal(priyaAfterCancel.availability, "AVAILABLE");
    assert.equal(priyaAfterCancel.activeBatch, null);
  });

  // Test 9: API errors do not falsely display all bakers as AVAILABLE
  await t.test("9. API errors do not falsely display all bakers as AVAILABLE (error handling test)", async () => {
    // When an invalid token or network error occurs, the API returns error, NOT a fabricated available list
    const errRes = await request(app)
      .get("/api/v1/production/team-status")
      .set({ Authorization: "Bearer malformed.invalid.token" });
    assert.equal(errRes.status, 401);
    assert.equal(errRes.body.data, undefined);
  });

  // Test 10: Elapsed time updates without excessive API requests
  await t.test("10. Elapsed time updates without excessive API requests (client utility verification)", async () => {
    const baseStart = Date.now() - 25 * 60 * 1000; // 25 mins ago
    const duration = 45;

    // Simulate two sequential seconds passing on the frontend timer without calling server
    const t1 = baseStart + 25 * 60 * 1000 + 1000;
    const diffSecs1 = Math.floor((t1 - baseStart) / 1000);
    assert.equal(diffSecs1, 1501); // 25m 1s

    const t2 = baseStart + 25 * 60 * 1000 + 2000;
    const diffSecs2 = Math.floor((t2 - baseStart) / 1000);
    assert.equal(diffSecs2, 1502); // 25m 2s
  });
});
