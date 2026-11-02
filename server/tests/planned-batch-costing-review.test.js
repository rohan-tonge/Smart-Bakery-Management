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
import ProductionBatch from "../src/models/productionBatch.model.js";
import Order from "../src/models/order.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES, CUSTOMER_ORDER_STATUSES } from "../src/utils/constants.js";
import mongoose from "mongoose";

test("Planned Batch Costing Review and Production Lifecycle Verification", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  let createdBatchId = null;
  let orderId = null;
  let lotId = null;
  let recipeId = null;
  let productId = null;
  let ingredientId = null;
  let categoryId = null;
  const userIds = [];

  t.after(async () => {
    try {
      if (createdBatchId) await ProductionBatch.deleteOne({ _id: createdBatchId });
      if (orderId) await Order.deleteOne({ _id: orderId });
      if (lotId) await InventoryLot.deleteOne({ _id: lotId });
      if (recipeId) await Recipe.deleteOne({ _id: recipeId });
      if (productId) await Product.deleteOne({ _id: productId });
      if (ingredientId) await Ingredient.deleteOne({ _id: ingredientId });
      if (categoryId) await Category.deleteOne({ _id: categoryId });
      if (userIds.length) await User.deleteMany({ _id: { $in: userIds } });
    } catch {
      // ignore cleanup errors
    }
    await disconnectDb();
  });

  // 1. Create Owner and Production Staff
  const owner = await User.create({
    name: `Owner ${suffix}`,
    email: `owner-${suffix}@planned-test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER,
  });
  userIds.push(owner._id);
  const ownerToken = generateAccessToken(owner);
  const ownerAuth = { Authorization: `Bearer ${ownerToken}` };

  const staff = await User.create({
    name: `Baker ${suffix}`,
    email: `baker-${suffix}@planned-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    hourlyLabourRate: 199.99,
  });
  userIds.push(staff._id);
  const staffToken = generateAccessToken(staff);
  const staffAuth = { Authorization: `Bearer ${staffToken}` };

  // 2. Catalog & Recipe setup
  const category = await Category.create({
    name: `Planned Cat ${suffix}`,
    slug: `planned-cat-${suffix}`,
  });
  categoryId = category._id;

  const flour = await Ingredient.create({
    name: `Flour ${suffix}`,
    slug: `flour-${suffix}`,
    unit: "kg",
    isActive: true,
  });
  ingredientId = flour._id;

  const flourLot = await InventoryLot.create({
    ingredient: flour._id,
    lotNumber: `LOT-FLOUR-${suffix}`,
    originalQuantity: 10,
    remainingQuantity: 10,
    unit: "kg",
    unitCost: 45, // ₹45.00/kg
    purchaseDate: new Date(),
    receivedDate: new Date(),
    expiryDate: new Date(Date.now() + 86400000 * 30),
    status: "AVAILABLE",
    supplierName: "Premium Flour Mill",
  });
  lotId = flourLot._id;

  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Chocolate Cake ${suffix}`,
    slug: `choc-cake-${suffix}`,
    category: category._id,
    isActive: true,
    isAvailable: true,
    variants: [
      {
        _id: variantId,
        name: "Regular",
        quantity: 1,
        unit: "piece",
        price: 499,
        isActive: true,
        isAvailable: true,
      },
    ],
  });
  productId = product._id;

  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    ingredients: [
      {
        ingredient: flour._id,
        quantity: 0.5,
        unit: "kg",
      },
    ],
    expectedYield: 1,
    yieldUnit: "piece",
    preparationTime: 20,
    productionTime: 40,
    isActive: true,
    revision: 1,
  });
  recipeId = recipe._id;

  // 3. Confirmed Customer Order
  const order = await Order.create({
    orderNumber: `ORD-TEST-${suffix}`,
    contactName: `Customer ${suffix}`,
    contactPhone: "9876543210",
    orderType: "PICKUP",
    deliveryDate: "2026-10-25",
    deliveryTimeSlot: "12:00 - 14:00",
    status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
    paymentStatus: "PAYMENT_CONFIRMED",
    items: [
      {
        productId: product._id,
        variantId,
        productName: product.name,
        variantName: "Regular",
        quantity: 1,
        unitPrice: 499,
        lineTotal: 499,
      },
    ],
    subtotal: 499,
    total: 499,
  });
  orderId = order._id;

  await t.test("Order assignment creates batch in PLANNED status with staff hourlyRateSnapshot", async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${order._id}/assign`)
      .set(ownerAuth)
      .send({ workers: [staff._id.toString()] });

    assert.equal(res.status, 201);
    assert.ok(Array.isArray(res.body.data.batches));
    assert.equal(res.body.data.batches.length, 1);

    const b = res.body.data.batches[0];
    createdBatchId = b._id;
    assert.equal(b.status, "PLANNED");
    assert.equal(b.plannedQuantity, 1);
    assert.equal(b.assignedWorkers.length, 1);
    assert.equal(b.assignedWorkers[0].worker.toString(), staff._id.toString());
    assert.equal(b.assignedWorkers[0].hourlyRateSnapshot, 199.99);
    assert.equal(b.assignedWorkers[0].actualHours, null);
    assert.deepEqual(b.consumedIngredients, []);
  });

  await t.test("Costing endpoint for PLANNED batch returns informative NOT_READY status with worker breakdown", async () => {
    const res = await request(app)
      .get(`/api/v1/production/batches/${createdBatchId}/cost`)
      .set(ownerAuth);

    assert.equal(res.status, 200);
    const cost = res.body.data.cost;
    assert.equal(cost.status, "NOT_READY");
    assert.equal(cost.costType, "ACTUAL");
    assert.equal(cost.productionStatus, "PLANNED");
    assert.equal(cost.productName, `Chocolate Cake ${suffix}`);
    assert.equal(cost.plannedQuantity, 1);
    assert.equal(cost.usableQuantity, null);

    // Verify assigned workers are populated with snapshot
    assert.ok(Array.isArray(cost.assignedWorkers));
    assert.equal(cost.assignedWorkers.length, 1);
    assert.equal(cost.assignedWorkers[0].workerId.toString(), staff._id.toString());
    assert.equal(cost.assignedWorkers[0].name, `Baker ${suffix}`);
    assert.equal(cost.assignedWorkers[0].hourlyRateSnapshot, 199.99);
    assert.equal(cost.assignedWorkers[0].actualHours, null);

    // Verify empty material snapshots and clear explanation
    assert.deepEqual(cost.materialSnapshots, []);
    assert.equal(cost.ingredientCost, 0);
    assert.equal(cost.labourCost, 0);
    assert.equal(cost.totalCost, 0);
    assert.ok(cost.incomplete.length >= 2);
    assert.ok(cost.incomplete.some((msg) => msg.includes("PLANNED")));
  });

  await t.test("Finalizing a PLANNED batch is rejected with 409 conflict", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/cost/finalize`)
      .set(ownerAuth)
      .send({ packagingCostPaise: 0, expenses: [] });

    assert.equal(res.status, 409);
    assert.equal(res.body.message, "Batch is not ready for cost finalization");
  });

  await t.test("Advancing batch through production lifecycle populates material consumption and unlocks finalization", async () => {
    const bDoc = await ProductionBatch.findById(createdBatchId);
    const plan = {
      batchNumber: bDoc.batchNumber,
      product: String(bDoc.product),
      plannedQuantity: bDoc.plannedQuantity,
      relatedOrders: bDoc.relatedOrders.map(String),
      assignedWorkers: bDoc.assignedWorkers.map((assignment) => String(assignment.worker)),
    };

    // 1. Staff accepts plan
    const acceptRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/accept`)
      .set(staffAuth)
      .send(plan);
    assert.equal(acceptRes.status, 200, acceptRes.body?.message);

    // 2. Owner verifies
    const verifyRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/verify`)
      .set(ownerAuth)
      .send(plan);
    assert.equal(verifyRes.status, 200, verifyRes.body?.message);

    // 3. Staff creates ingredient requisition
    const reqRes = await request(app)
      .post(`/api/v1/requisitions/batch/${createdBatchId}`)
      .set(staffAuth)
      .send({
        items: [
          { ingredientId: String(flour._id), requestedQuantity: 0.5, unit: "kg" },
        ],
        notes: "Flour for cake batch",
      });
    assert.equal(reqRes.status, 201, reqRes.body?.message);
    const requisitionId = reqRes.body.data.requisition._id;

    // 4. Owner approves requisition
    const appRes = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/approve`)
      .set(ownerAuth)
      .send({});
    assert.equal(appRes.status, 200, appRes.body?.message);

    // 5. Owner issues requisition (deducts stock and records batch consumption)
    const issueRes = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/issue`)
      .set(ownerAuth)
      .send({});
    assert.equal(issueRes.status, 200, issueRes.body?.message);

    // 6. Staff starts production
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/start`)
      .set(staffAuth);
    assert.equal(startRes.status, 200, startRes.body?.message);

    // 7. Staff completes baking
    const completeRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/complete`)
      .set(staffAuth)
      .send({
        producedQuantity: 1,
        usableQuantity: 1,
        wastageQuantity: 0,
      });
    assert.equal(completeRes.status, 200, completeRes.body?.message);

    // 8. Record worker actual hours prior to packaging (or let timer auto-track)
    const hourRes = await request(app)
      .patch(`/api/v1/production/batches/${createdBatchId}/assignment`)
      .set(staffAuth)
      .send({
        workerId: staff._id.toString(),
        actualHours: 1.5,
      });
    assert.equal(hourRes.status, 200, hourRes.body?.message);

    // 9. Packaging triggers automatic costing and finalization
    const pkgRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/package`)
      .set(staffAuth)
      .send({});
    assert.equal(pkgRes.status, 200, pkgRes.body?.message);

    // 10. Costing endpoint returns FINALIZED automatically with full lot & labour breakdown
    const costRes = await request(app)
      .get(`/api/v1/production/batches/${createdBatchId}/cost`)
      .set(ownerAuth);

    assert.equal(costRes.status, 200, costRes.body?.message);
    const finalized = costRes.body.data.cost;
    assert.equal(finalized.status, "FINALIZED");
    assert.equal(finalized.materialSnapshots.length, 1);
    assert.equal(finalized.materialSnapshots[0].lotNumber, `LOT-FLOUR-${suffix}`);
    // 0.5 kg @ ₹45.00/kg = ₹22.50
    assert.equal(finalized.ingredientCost, 22.5);
    // 1.5 hrs @ ₹199.99/hr = ₹299.985 -> ₹299.99
    assert.equal(finalized.labourCost, 299.99);
    // Total = 22.50 + 299.99 = ₹322.49 (0 packaging configured)
    assert.equal(finalized.totalCost, 322.49);
    assert.equal(finalized.costPerUsableItem, 322.49);

    // 11. Repeated manual finalization attempt is safely rejected since batch is already auto-finalized
    const finalizeRes = await request(app)
      .post(`/api/v1/production/batches/${createdBatchId}/cost/finalize`)
      .set(ownerAuth)
      .send({ packagingCost: 5, expenses: [] });

    assert.equal(finalizeRes.status, 409);
    assert.equal(finalizeRes.body.message, "Production cost is already finalized");
  });
});
