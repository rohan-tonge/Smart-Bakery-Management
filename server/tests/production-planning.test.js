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
import Order from "../src/models/order.model.js";
import Notification from "../src/models/notification.model.js";
import Setting from "../src/models/setting.model.js";
import capacityService from "../src/services/capacity.service.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";

test("Production Planning creates, checks, adjusts, and approves batch plans", async (t) => {
  await connectToDb();
  const existingCapacitySetting = await Setting.findOne({ key: "PRODUCTION_CAPACITY" }).lean();
  await Setting.deleteOne({ key: "PRODUCTION_CAPACITY" });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF, USER_ROLES.CUSTOMER]) {
    const user = await User.create({ name: `Planning ${role}`, email: `${role.toLowerCase()}-${suffix}@planning-test.com`, password: "Password123!", role });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });
  const category = await Category.create({ name: `Planning ${suffix}`, slug: `planning-${suffix}` });
  const product = await Product.create({ name: `Planning Bread ${suffix}`, slug: `planning-bread-${suffix}`, category: category._id, variants: [{ name: "Loaf", quantity: 1, unit: "piece", price: 5 }] });
  const flour = await Ingredient.create({ name: `Planning flour ${suffix}`, slug: `planning-flour-${suffix}`, unit: "g", minimumStock: 10 });
  const cocoa = await Ingredient.create({ name: `Planning cocoa ${suffix}`, slug: `planning-cocoa-${suffix}`, unit: "g", minimumStock: 10 });
  const flourLot = await InventoryLot.create({ ingredient: flour._id, lotNumber: `PLAN-F-${suffix}`, originalQuantity: 2000, remainingQuantity: 2000, unit: "g", unitCost: 0, purchaseDate: new Date(), status: "AVAILABLE" });
  const cocoaLot = await InventoryLot.create({ ingredient: cocoa._id, lotNumber: `PLAN-C-${suffix}`, originalQuantity: 500, remainingQuantity: 500, unit: "g", unitCost: 0, purchaseDate: new Date(), status: "AVAILABLE" });
  const variant = product.variants[0];
  const recipe = await Recipe.create({ product: product._id, variant: variant._id, ingredients: [{ ingredient: flour._id, quantity: 500, unit: "g" }, { ingredient: cocoa._id, quantity: 200, unit: "g" }], expectedYield: 10, yieldUnit: "piece", preparationTime: 30, productionTime: 60 });
  const order = await Order.create({ orderNumber: `PLAN-${suffix}`, customer: users[USER_ROLES.CUSTOMER].user._id, items: [{ productId: product._id, variantId: variant._id, productName: product.name, variantName: "Loaf", quantity: 10, unitPrice: 5, lineTotal: 50 }], subtotal: 50, total: 50, orderType: "PICKUP", contactName: "Planning customer", contactPhone: "9876543210", status: "CONFIRMED" });
  const plans = [];
  t.after(async () => {
    const planIds = plans.map((plan) => plan._id);
    await Notification.deleteMany({ relatedEntityId: { $in: planIds } });
    await ProductionBatch.deleteMany({ createdBy: users[USER_ROLES.OWNER].user._id });
    await InventoryTransaction.deleteMany({ ingredient: { $in: [flour._id, cocoa._id] } });
    await InventoryLot.deleteMany({ _id: { $in: [flourLot._id, cocoaLot._id] } });
    await Order.deleteOne({ _id: order._id });
    await Recipe.deleteOne({ _id: recipe._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await Ingredient.deleteMany({ _id: { $in: [flour._id, cocoa._id] } });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@planning-test\\.com$`) });
    if (existingCapacitySetting) {
      delete existingCapacitySetting._id;
      await Setting.updateOne({ key: "PRODUCTION_CAPACITY" }, { $set: existingCapacitySetting }, { upsert: true });
    } else {
      await Setting.deleteOne({ key: "PRODUCTION_CAPACITY" });
    }
    await disconnectDb();
  });

  const productionDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const payload = {
    product: String(product._id),
    productVariant: String(variant._id),
    plannedQuantity: 40,
    relatedOrders: [String(order._id)],
    assignedWorkers: [{ worker: String(users[USER_ROLES.PRODUCTION_STAFF].user._id), task: "Baking" }],
    productionDate,
    timeSlot: { startTime: "09:00", endTime: "11:00" },
  };

  await t.test("authorization, validation, resource checks, and no inventory mutation", async () => {
    assert.equal((await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.CUSTOMER)).send(payload)).status, 403);
    assert.equal((await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.PRODUCTION_STAFF)).send(payload)).status, 403);
    assert.equal((await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.OWNER)).send({ ...payload, product: "000000000000000000000000" })).status, 400);
    assert.equal((await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.OWNER)).send({ ...payload, plannedQuantity: 0 })).status, 400);
    assert.equal((await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.OWNER)).send({ ...payload, assignedWorkers: [{ worker: String(users[USER_ROLES.OWNER].user._id) }] })).status, 400);
    assert.equal((await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.OWNER)).send({ ...payload, productionDate: "2026-02-31" })).status, 400);
    assert.equal((await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.OWNER)).send({ ...payload, timeSlot: { startTime: "11:00", endTime: "09:00" } })).status, 400);
    assert.equal((await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.OWNER)).send({ ...payload, timeSlot: undefined })).status, 400);

    const created = await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.OWNER)).send(payload);
    assert.equal(created.status, 201, created.body.message);
    const plan = created.body.data.plan;
    plans.push(plan);
    const workerTasks = await request(app).get(`/api/v1/workers/me/batches?date=${productionDate}`).set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(workerTasks.status, 200, workerTasks.body.message);
    assert.ok(workerTasks.body.data.batches.some((batch) => String(batch._id) === String(plan._id)));
    assert.equal(plan.planningStatus, "INFEASIBLE");
    assert.equal(plan.planningFeasibility.ingredients.status, "INSUFFICIENT");
    assert.equal(plan.planningFeasibility.ingredients.shortages.length, 2);
    assert.ok(plan.planningFeasibility.ingredients.shortages.every((line) => line.orderRequired));
    const alerts = await request(app).get("/api/v1/alerts").set(auth(USER_ROLES.MANAGER));
    assert.equal(alerts.status, 200);
    assert.ok(alerts.body.data.alerts.orderNeededPlans.some((item) => String(item.batchId) === String(plan._id)));
    assert.equal(plan.planningFeasibility.staff.status, "AVAILABLE");
    assert.equal(plan.planningFeasibility.timeSlot.status, "AVAILABLE");
    assert.equal(plan.planningFeasibility.estimatedDurationMinutes, 90);
    assert.equal(plan.planningFeasibility.capacity.status, "NOT_CONFIGURED");
    assert.equal(plan.planningFeasibility.feasible, false);
    const checked = await request(app).post(`/api/v1/production/plans/${plan._id}/check-feasibility`).set(auth(USER_ROLES.MANAGER));
    assert.equal(checked.status, 200);
    assert.equal(checked.body.data.plan.planningFeasibility.capacity.status, "NOT_CONFIGURED");
    assert.equal((await InventoryLot.findById(flourLot._id)).remainingQuantity, 2000);
    assert.equal((await InventoryLot.findById(cocoaLot._id)).remainingQuantity, 500);
    assert.equal(await InventoryTransaction.countDocuments({ ingredient: { $in: [flour._id, cocoa._id] } }), 0);
    assert.equal((await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.OWNER)).send(payload)).status, 409);
    assert.equal((await request(app).get(`/api/v1/production/plans?date=${productionDate}`).set(auth(USER_ROLES.MANAGER))).body.data.plans.length, 1);
    assert.equal((await request(app).get(`/api/v1/production/plans/${plan._id}`).set(auth(USER_ROLES.MANAGER))).status, 200);
  });

  await t.test("quantity adjustment recalculates and approval rechecks current resources", async () => {
    const initial = plans[0];
    const invalidQuantity = await request(app).patch(`/api/v1/production/plans/${initial._id}`).set(auth(USER_ROLES.MANAGER)).send({ plannedQuantity: 0 });
    assert.equal(invalidQuantity.status, 400);
    const adjusted = await request(app).patch(`/api/v1/production/plans/${initial._id}`).set(auth(USER_ROLES.MANAGER)).send({ plannedQuantity: 20 });
    assert.equal(adjusted.status, 200, adjusted.body.message);
    assert.equal(adjusted.body.data.plan.plannedQuantity, 20);
    assert.equal(adjusted.body.data.plan.recipeSnapshot.recipeBatchQuantity, 2);
    assert.equal(adjusted.body.data.plan.planningFeasibility.ingredients.status, "SUFFICIENT");
    assert.equal(adjusted.body.data.plan.planningFeasibility.ingredients.shortages.length, 0);
    assert.equal(adjusted.body.data.plan.planningFeasibility.capacity.status, "NOT_CONFIGURED");
    assert.equal((await request(app).post(`/api/v1/production/plans/${initial._id}/approve`).set(auth(USER_ROLES.PRODUCTION_STAFF))).status, 403);
    assert.equal((await request(app).post(`/api/v1/production/plans/${initial._id}/approve`).set(auth(USER_ROLES.OWNER))).status, 409);

    const originalAssess = capacityService.assess;
    capacityService.assess = () => ({ status: "AVAILABLE", configured: true });
    try {
      const cocoaStock = await InventoryLot.findById(cocoaLot._id);
      cocoaStock.remainingQuantity = 100;
      await cocoaStock.save();
      const staleApproval = await request(app).post(`/api/v1/production/plans/${initial._id}/approve`).set(auth(USER_ROLES.MANAGER));
      assert.equal(staleApproval.status, 409);
      cocoaStock.remainingQuantity = 500;
      await cocoaStock.save();
      const approved = await request(app).post(`/api/v1/production/plans/${initial._id}/approve`).set(auth(USER_ROLES.MANAGER));
      assert.equal(approved.status, 200, approved.body.message);
      assert.equal(approved.body.data.plan.planningStatus, "APPROVED");
      assert.equal(String(approved.body.data.plan.approvedBy), String(users[USER_ROLES.MANAGER].user._id));
      assert.ok(approved.body.data.plan.approvedAt);
      assert.equal((await request(app).post(`/api/v1/production/plans/${initial._id}/approve`).set(auth(USER_ROLES.MANAGER))).status, 409);

      const acceptedPlan = {
        batchNumber: approved.body.data.plan.batchNumber,
        product: String(approved.body.data.plan.product),
        plannedQuantity: approved.body.data.plan.plannedQuantity,
        relatedOrders: approved.body.data.plan.relatedOrders.map((item) => String(item._id || item)),
        assignedWorkers: approved.body.data.plan.assignedWorkers.map((item) => String(item.worker._id || item.worker)),
      };
      const workerAuth = auth(USER_ROLES.PRODUCTION_STAFF);
      const accepted = await request(app).post(`/api/v1/production/batches/${initial._id}/accept`).set(workerAuth).send(acceptedPlan);
      assert.equal(accepted.status, 200, accepted.body.message);
      assert.equal(accepted.body.data.batch.status, "ACCEPTED");
      const verified = await request(app).post(`/api/v1/production/batches/${initial._id}/verify`).set(auth(USER_ROLES.MANAGER)).send(acceptedPlan);
      assert.equal(verified.status, 200, verified.body.message);
      const started = await request(app).post(`/api/v1/production/batches/${initial._id}/start`).set(workerAuth);
      assert.equal(started.status, 200, started.body.message);
      assert.equal(started.body.data.batch.status, "IN_PRODUCTION");
    } finally {
      capacityService.assess = originalAssess;
    }
  });

  await t.test("worker overlap is reported and infeasible plan approval is blocked", async () => {
    const conflictPlanPayload = { ...payload, plannedQuantity: 10, timeSlot: { startTime: "09:30", endTime: "11:30" } };
    const created = await request(app).post("/api/v1/production/plans").set(auth(USER_ROLES.OWNER)).send(conflictPlanPayload);
    assert.equal(created.status, 201, created.body.message);
    plans.push(created.body.data.plan);
    assert.equal(created.body.data.plan.planningFeasibility.staff.status, "CONFLICT");
    assert.ok(created.body.data.plan.planningFeasibility.staff.conflicts.length > 0);
    assert.equal((await request(app).post(`/api/v1/production/plans/${created.body.data.plan._id}/approve`).set(auth(USER_ROLES.OWNER))).status, 409);
  });
});
