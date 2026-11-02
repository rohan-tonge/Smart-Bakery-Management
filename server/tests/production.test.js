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
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import Order from "../src/models/order.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";

test("Phase 8: workers, production batches, inventory consumption, and finished stock", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF, USER_ROLES.CUSTOMER]) {
    const user = await User.create({ name: `Phase 8 ${role}`, email: `${role.toLowerCase()}-${suffix}@phase8-test.com`, password: "Password123!", role });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });
  const category = await Category.create({ name: `Phase 8 ${suffix}`, slug: `phase-8-${suffix}` });
  const product = await Product.create({ name: `Production Cake ${suffix}`, slug: `production-cake-${suffix}`, category: category._id, variants: [{ name: "Single", quantity: 1, unit: "piece", price: 10 }] });
  const ingredient = await Ingredient.create({ name: `Phase 8 Flour ${suffix}`, slug: `phase-8-flour-${suffix}`, unit: "g", minimumStock: 10 });
  let workerId; let batchId; let orderId;
  const variantId = product.variants[0]._id;
  const lot = await InventoryLot.create({ ingredient: ingredient._id, lotNumber: `P8-${suffix}`, originalQuantity: 3000, remainingQuantity: 3000, unit: "g", unitCost: 0, purchaseDate: new Date(), status: "AVAILABLE" });
  const recipe = await Recipe.create({ product: product._id, variant: variantId, ingredients: [{ ingredient: ingredient._id, quantity: 500, unit: "g" }], expectedYield: 10, yieldUnit: "piece" });
  const order = await Order.create({ orderNumber: `P8-${suffix}`, customer: users.CUSTOMER.user._id, items: [{ productId: product._id, variantId, productName: product.name, variantName: "Single", quantity: 2, unitPrice: 10, lineTotal: 20 }], subtotal: 20, total: 20, orderType: "PICKUP", contactName: "Test", contactPhone: "1234567890", status: "CONFIRMED", paymentStatus: "PAYMENT_CONFIRMED" });
  orderId = order._id;

  t.after(async () => {
    await ProductionBatch.deleteMany({ createdBy: users.OWNER.user._id });
    await InventoryTransaction.deleteMany({ ingredient: ingredient._id });
    await InventoryLot.deleteOne({ _id: lot._id });
    await FinishedProductStock.deleteMany({ product: product._id });
    await Recipe.deleteMany({ product: product._id });
    await Order.deleteOne({ _id: orderId });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await Ingredient.deleteOne({ _id: ingredient._id });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@phase8-test\\.com$`) });
    await disconnectDb();
  });

  await t.test("worker access and active assignment validation", async () => {
    assert.equal((await request(app).post("/api/v1/workers").set(auth(USER_ROLES.CUSTOMER)).send({})).status, 403);
    const create = await request(app).post("/api/v1/workers").set(auth(USER_ROLES.OWNER)).send({ name: "Bakery Staff", email: `worker-${suffix}@phase8-test.com`, password: "StrongPass123!", jobDesignation: "Baker", hourlyLabourRate: 25 });
    assert.equal(create.status, 201);
    assert.equal(create.body.data.worker.role, USER_ROLES.PRODUCTION_STAFF);
    assert.equal(create.body.data.worker.password, undefined);
    workerId = create.body.data.worker._id;
    assert.equal((await request(app).get("/api/v1/workers").set(auth(USER_ROLES.MANAGER))).status, 200);
    assert.equal((await request(app).get("/api/v1/workers").set(auth(USER_ROLES.CUSTOMER))).status, 403);
    const detail = await request(app).get(`/api/v1/workers/${workerId}`).set(auth(USER_ROLES.MANAGER));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.worker.email, `worker-${suffix}@phase8-test.com`);
    assert.equal((await request(app).get(`/api/v1/workers/${workerId}`).set(auth(USER_ROLES.PRODUCTION_STAFF))).status, 403);
    const updated = await request(app).patch(`/api/v1/workers/${workerId}`).set(auth(USER_ROLES.OWNER)).send({ phone: "555-0102" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.worker.phone, "555-0102");
    assert.equal((await request(app).patch(`/api/v1/workers/${workerId}`).set(auth(USER_ROLES.MANAGER)).send({})).status, 400);
    const temporary = await request(app).post("/api/v1/workers").set(auth(USER_ROLES.MANAGER)).send({ name: "Temporary Worker", email: `temporary-${suffix}@phase8-test.com`, password: "StrongPass123!" });
    assert.equal(temporary.status, 201);
    const deactivated = await request(app).delete(`/api/v1/workers/${temporary.body.data.worker._id}`).set(auth(USER_ROLES.OWNER));
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.data.worker.isActive, false);
    assert.equal((await request(app).get(`/api/v1/workers/${temporary.body.data.worker._id}`).set(auth(USER_ROLES.OWNER))).status, 200);
  });

  await t.test("planning snapshots recipe revision, scaled quantities, and confirmed orders", async () => {
    const payload = { product: String(product._id), productVariant: String(variantId), plannedQuantity: 20, relatedOrders: [String(orderId)], assignedWorkers: [{ worker: workerId, task: "Mixing" }] };
    const beforeStart = await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.MANAGER)).send({ ...payload, plannedQuantity: 10, assignedWorkers: [] });
    assert.equal(beforeStart.status, 201);
    const plannedId = beforeStart.body.data.batch._id;
    const plannedList = await request(app).get("/api/v1/production/batches?status=PLANNED").set(auth(USER_ROLES.MANAGER));
    assert.equal(plannedList.status, 200);
    assert.ok(plannedList.body.data.batches.some((item) => item._id === plannedId));
    assert.equal((await request(app).get("/api/v1/production/batches").set(auth(USER_ROLES.CUSTOMER))).status, 403);
    const plannedUpdate = await request(app).patch(`/api/v1/production/batches/${plannedId}`).set(auth(USER_ROLES.MANAGER)).send({ productionNotes: "Updated before baking" });
    assert.equal(plannedUpdate.status, 200);
    assert.equal(plannedUpdate.body.data.batch.productionNotes, "Updated before baking");
    assert.equal((await request(app).patch(`/api/v1/production/batches/${plannedId}`).set(auth(USER_ROLES.MANAGER)).send({})).status, 400);
    assert.equal((await request(app).patch(`/api/v1/production/batches/${plannedId}`).set(auth(USER_ROLES.CUSTOMER)).send({ productionNotes: "No" })).status, 403);
    const inactiveWorker = await User.findById(workerId); inactiveWorker.isActive = false; await inactiveWorker.save();
    assert.equal((await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.OWNER)).send(payload)).status, 400);
    inactiveWorker.isActive = true; await inactiveWorker.save();
    product.isActive = false; await product.save();
    assert.equal((await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.MANAGER)).send(payload)).status, 400);
    product.isActive = true; await product.save();
    product.variants.id(variantId).isActive = false; await product.save();
    assert.equal((await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.MANAGER)).send(payload)).status, 400);
    product.variants.id(variantId).isActive = true; await product.save();
    const badOrder = await Order.create({ orderNumber: `P8-CANCELLED-${suffix}`, customer: users.CUSTOMER.user._id, items: [{ productId: product._id, variantId, productName: product.name, variantName: "Single", quantity: 1, unitPrice: 10, lineTotal: 10 }], subtotal: 10, total: 10, orderType: "PICKUP", contactName: "Test", contactPhone: "1234567890", status: "CANCELLED" });
    assert.equal((await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.MANAGER)).send({ ...payload, relatedOrders: [String(badOrder._id)] })).status, 400);
    await Order.deleteOne({ _id: badOrder._id });
    const created = await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.MANAGER)).send(payload);
    assert.equal(created.status, 201, created.body.message);
    batchId = created.body.data.batch._id;
    assert.match(created.body.data.batch.batchNumber, /^BATCH-\d{8}-\d{4}$/);
    assert.equal(created.body.data.batch.recipeRevision, recipe.revision);
    assert.equal(created.body.data.batch.productSnapshot.productName, product.name);
    assert.equal(created.body.data.batch.recipeSnapshot.recipeBatchQuantity, 2);
    assert.equal(created.body.data.batch.recipeSnapshot.ingredients[0].quantity, 1000);
    assert.equal(created.body.data.batch.status, "PLANNED");
    const assignment = await request(app).post(`/api/v1/production/orders/${orderId}/assign`).set(auth(USER_ROLES.MANAGER)).send({ worker: workerId });
    assert.equal(assignment.status, 201, assignment.body.message);
    assert.equal(assignment.body.data.batches.length, 1);
    assert.equal(String(assignment.body.data.batches[0]._id), String(plannedId));
    assert.equal((await request(app).post(`/api/v1/production/orders/${orderId}/assign`).set(auth(USER_ROLES.CUSTOMER)).send({ worker: workerId })).status, 403);
    const recipeDoc = await Recipe.findById(recipe._id); recipeDoc.revision += 1; await recipeDoc.save();
    assert.equal((await ProductionBatch.findById(batchId)).recipeRevision, 1);
    const incompatible = await Recipe.findById(recipe._id); incompatible.ingredients[0].unit = "ml"; await incompatible.save();
    assert.equal((await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.MANAGER)).send(payload)).status, 400);
    incompatible.ingredients[0].unit = "g"; await incompatible.save();
    const shortage = await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.MANAGER)).send({ ...payload, plannedQuantity: 80, relatedOrders: [] });
    assert.equal(shortage.status, 201);
    assert.equal((await request(app).post(`/api/v1/production/batches/${shortage.body.data.batch._id}/start`).set(auth(USER_ROLES.MANAGER))).status, 409);
    assert.equal((await request(app).post(`/api/v1/production/batches/${shortage.body.data.batch._id}/cancel`).set(auth(USER_ROLES.MANAGER))).status, 200);
    assert.equal((await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.CUSTOMER)).send(payload)).status, 403);
    assert.equal((await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.OWNER)).send({ ...payload, plannedQuantity: 0 })).status, 400);
  });

  await t.test("staff acceptance and batch verification gate production", async () => {
    const workerUser = await User.findById(workerId);
    const workerAuth = { Authorization: `Bearer ${generateAccessToken(workerUser)}` };
    const workerBatches = (await request(app).get("/api/v1/workers/me/batches").set(workerAuth)).body.data.batches;
    assert.ok(workerBatches.some((batch) => batch._id === batchId));
    assert.equal((await request(app).get("/api/v1/workers/me/batches?date=2025-02-30").set(workerAuth)).status, 400);
    const batch = await ProductionBatch.findById(batchId);
    const plan = {
      batchNumber: batch.batchNumber,
      product: String(batch.product),
      plannedQuantity: batch.plannedQuantity,
      relatedOrders: batch.relatedOrders.map(String),
      assignedWorkers: batch.assignedWorkers.map((assignment) => String(assignment.worker)),
    };
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/verify`).send(plan)).status, 401);
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/accept`).set(auth(USER_ROLES.CUSTOMER)).send(plan)).status, 403);
    assert.equal((await request(app).post(`/api/v1/production/batches/${"a".repeat(24)}/accept`).set(workerAuth).send(plan)).status, 404);
    assert.equal((await request(app).post(`/api/v1/production/batches/${"b".repeat(24)}/verify`).set(workerAuth).send(plan)).status, 404);
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/verify`).set(workerAuth).send(plan)).status, 409);
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/start`).set(workerAuth)).status, 409);
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/consume`).set(workerAuth)).status, 409);
    assert.equal((await InventoryLot.findById(lot._id)).remainingQuantity, 3000);
    assert.equal(await InventoryTransaction.countDocuments({ referenceType: "PRODUCTION", referenceId: batchId }), 0);
    const accepted = await request(app).post(`/api/v1/production/batches/${batchId}/accept`).set(workerAuth).send(plan);
    assert.equal(accepted.status, 200, accepted.body.message);
    assert.equal(accepted.body.data.batch.status, "ACCEPTED");
    assert.ok(accepted.body.data.batch.acceptedAt);
    for (const changedPlan of [
      { ...plan, product: String(new mongoose.Types.ObjectId()) },
      { ...plan, plannedQuantity: plan.plannedQuantity + 1 },
      { ...plan, relatedOrders: [] },
      { ...plan, assignedWorkers: [] },
      { ...plan, batchNumber: "WRONG-BATCH" },
    ]) {
      const mismatch = await request(app).post(`/api/v1/production/batches/${batchId}/verify`).set(workerAuth).send(changedPlan);
      assert.equal(mismatch.status, 409, mismatch.body.message);
    }
    assert.equal((await ProductionBatch.findById(batchId)).verificationStatus, "PENDING");
    assert.equal((await InventoryLot.findById(lot._id)).remainingQuantity, 3000);
    const managerAuth = auth(USER_ROLES.MANAGER);
    const verified = await request(app).post(`/api/v1/production/batches/${batchId}/verify`).set(managerAuth).send(plan);
    assert.equal(verified.status, 200, verified.body.message);
    assert.equal(verified.body.message, "Batch verified. Ingredients are ready for issue.");
    assert.equal(verified.body.data.batch.status, "VERIFIED");
    assert.equal(verified.body.data.batch.verificationStatus, "VERIFIED");
    assert.equal(String(verified.body.data.batch.verifiedBy), String(users[USER_ROLES.MANAGER].user._id));
    assert.ok(verified.body.data.batch.verifiedAt);
    assert.equal((await InventoryLot.findById(lot._id)).remainingQuantity, 3000);
    assert.equal(await InventoryTransaction.countDocuments({ referenceType: "PRODUCTION", referenceId: batchId }), 0);
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/verify`).set(workerAuth).send(plan)).status, 409);
    const responses = await Promise.all([
      request(app).post(`/api/v1/production/batches/${batchId}/start`).set(workerAuth),
      request(app).post(`/api/v1/production/batches/${batchId}/start`).set(managerAuth),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal((await ProductionBatch.findById(batchId)).assignedWorkers[0].taskStatus, "IN_PROGRESS");
    const assignments = await request(app).patch(`/api/v1/workers/batches/${batchId}/assignment`).set(workerAuth).send({ actualHours: 0.5, taskStatus: "IN_PROGRESS" });
    assert.equal(assignments.status, 200, assignments.body.message);
    assert.equal(assignments.body.data.batch.assignedWorkers[0].actualHours, 0.5);
    assert.equal(assignments.body.data.batch.costing, undefined);
    assert.equal((await request(app).patch(`/api/v1/workers/batches/${batchId}/assignment`).set(auth(USER_ROLES.MANAGER)).send({ actualHours: 1 })).status, 403);
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/finalize`).set(auth(USER_ROLES.PRODUCTION_STAFF))).status, 403);
  });

  await t.test("consumption records FEFO lot transactions and is idempotent", async () => {
    const worker = await User.findById(workerId); const workerAuth = { Authorization: `Bearer ${generateAccessToken(worker)}` };
    const consumed = await request(app).post(`/api/v1/production/batches/${batchId}/consume`).set(workerAuth);
    assert.equal(consumed.status, 200, consumed.body.message);
    assert.equal(consumed.body.data.batch.consumedIngredients.length, 1);
    assert.equal(consumed.body.data.batch.consumedIngredients[0].lotNumber, lot.lotNumber);
    assert.equal((await InventoryLot.findById(lot._id)).remainingQuantity, 2000);
    assert.equal(await InventoryTransaction.countDocuments({ referenceType: "PRODUCTION", referenceId: batchId, direction: "OUT" }), 1);
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/consume`).set(workerAuth)).status, 409);
    const detail = await request(app).get(`/api/v1/production/batches/${batchId}`).set(workerAuth);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.batch.costing, undefined);
    assert.equal(detail.body.data.batch.consumedIngredients[0].unitCostSnapshot, undefined);
    assert.deepEqual(detail.body.data.batch.wastageRecords, []);
    const workerTaskList = await request(app).get("/api/v1/workers/me/batches").set(workerAuth);
    assert.equal(workerTaskList.body.data.batches.find((item) => item._id === batchId).costing, undefined);
  });

  await t.test("baking completion moves directly to packaging without quality-check step", async () => {
    const worker = await User.findById(workerId); const workerAuth = { Authorization: `Bearer ${generateAccessToken(worker)}` };
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/complete`).set(workerAuth).send({ producedQuantity: 10, usableQuantity: 8, wastageQuantity: 1 })).status, 400);
    const done = await request(app).post(`/api/v1/production/batches/${batchId}/complete`).set(workerAuth).send({ producedQuantity: 10, usableQuantity: 8, wastageQuantity: 2, productionNotes: "Oven run" });
    assert.equal(done.status, 200, done.body.message);
    // Active production moves directly from IN_PRODUCTION to PACKAGING
    assert.equal(done.body.data.batch.status, "PACKAGING");
    assert.equal(await FinishedProductStock.countDocuments({ product: product._id, variant: variantId }), 0);
    assert.equal((await Order.findById(orderId)).status, "CONFIRMED");
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/complete`).set(workerAuth).send({ producedQuantity: 10, usableQuantity: 8, wastageQuantity: 2 })).status, 409);
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/cost/finalize`).set(auth(USER_ROLES.OWNER)).send({})).status, 409);
    const packageResponses = await Promise.all([
      request(app).post(`/api/v1/production/batches/${batchId}/package`).set(workerAuth).send({ packagedQuantity: 8 }),
      request(app).post(`/api/v1/production/batches/${batchId}/package`).set(workerAuth).send({ packagedQuantity: 8 }),
    ]);
    assert.deepEqual(packageResponses.map((response) => response.status).sort(), [200, 409]);
    const packaged = packageResponses.find((response) => response.status === 200);
    assert.equal(packaged.body.data.batch.status, "PACKAGED");
    assert.equal(String(packaged.body.data.batch.packagedBy), workerId);
    assert.ok(packaged.body.data.batch.packagedAt);
    assert.equal((await FinishedProductStock.findOne({ product: product._id, variant: variantId })).onHandQuantity, 8);
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/package`).set(workerAuth).send({})).status, 409);
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/finalize`).set(workerAuth)).status, 200);
    assert.equal((await ProductionBatch.findById(batchId)).status, "COMPLETED");
    assert.equal((await request(app).post(`/api/v1/production/batches/${batchId}/deliver`).set(auth(USER_ROLES.MANAGER))).status, 200);
    assert.equal((await FinishedProductStock.findOne({ product: product._id, variant: variantId })).onHandQuantity, 8);
  });

  await t.test("rejection handling and legacy batch failure protection", async () => {
    const worker = await User.findById(workerId);
    const workerAuth = { Authorization: `Bearer ${generateAccessToken(worker)}` };
    const rejected = await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.MANAGER)).send({
      product: String(product._id), productVariant: String(variantId), plannedQuantity: 10,
      relatedOrders: [], assignedWorkers: [{ worker: workerId, task: "Baking" }],
    });
    assert.equal(rejected.status, 201, rejected.body.message);
    const rejection = await request(app).post(`/api/v1/production/batches/${rejected.body.data.batch._id}/reject`).set(workerAuth).send({ reason: "Unavailable for assigned work" });
    assert.equal(rejection.status, 200, rejection.body.message);
    assert.equal(rejection.body.data.batch.status, "PLANNED");
    assert.equal(String(rejection.body.data.batch.rejectedBy), workerId);
    assert.notEqual(String(rejection.body.data.batch.assignedWorkers[0].worker), workerId);
    assert.equal((await request(app).post(`/api/v1/production/batches/${rejected.body.data.batch._id}/start`).set(workerAuth)).status, 403);
    const created = await request(app).post("/api/v1/production/batches").set(auth(USER_ROLES.MANAGER)).send({
      product: String(product._id), productVariant: String(variantId), plannedQuantity: 10,
      relatedOrders: [], assignedWorkers: [{ worker: workerId, task: "Baking" }],
    });
    assert.equal(created.status, 201, created.body.message);
    const failedBatchId = created.body.data.batch._id;
    const batch = await ProductionBatch.findById(failedBatchId);
    const plan = { batchNumber: batch.batchNumber, product: String(batch.product), plannedQuantity: 10, relatedOrders: [], assignedWorkers: [workerId] };
    for (const [path, payload] of [["accept", plan], ["verify", plan], ["start", undefined], ["consume", undefined], ["complete", { producedQuantity: 10, usableQuantity: 8, wastageQuantity: 2 }]]) {
      const req = request(app).post(`/api/v1/production/batches/${failedBatchId}/${path}`).set(workerAuth);
      const response = payload === undefined ? await req : await req.send(payload);
      assert.equal(response.status, 200, response.body.message);
    }
    // Mark as legacy failure state
    await ProductionBatch.findByIdAndUpdate(failedBatchId, { status: "QUALITY_FAILED" });
    assert.equal((await request(app).post(`/api/v1/production/batches/${failedBatchId}/package`).set(workerAuth).send({})).status, 409);
    assert.equal(await FinishedProductStock.countDocuments({ product: product._id, variant: variantId }), 1);
  });
});
