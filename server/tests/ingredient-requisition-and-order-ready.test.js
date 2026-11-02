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
import IngredientRequisition, { REQUISITION_STATUS } from "../src/models/ingredientRequisition.model.js";
import Order from "../src/models/order.model.js";
import Notification from "../src/models/notification.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES, PRODUCTION_STATUS as S, CUSTOMER_ORDER_STATUSES } from "../src/utils/constants.js";

test("Ingredient Requisition Restoration and Order READY Status Transition Suite", async (t) => {
  await connectToDb();
  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create Users: Owner, Manager, Staff, Other Staff, Customer
  const owner = await User.create({
    name: `Owner ${suffix}`,
    email: `owner-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER_MANAGER,
    isActive: true,
  });
  const ownerToken = generateAccessToken(owner);
  const ownerAuth = { Authorization: `Bearer ${ownerToken}` };

  const manager = await User.create({
    name: `Manager ${suffix}`,
    email: `manager-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.MANAGER,
    isActive: true,
  });
  const managerToken = generateAccessToken(manager);
  const managerAuth = { Authorization: `Bearer ${managerToken}` };

  const staff = await User.create({
    name: `Baker Rohan ${suffix}`,
    email: `baker-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    jobDesignation: "Pastry Chef",
    hourlyLabourRate: 250,
    isActive: true,
  });
  const staffToken = generateAccessToken(staff);
  const staffAuth = { Authorization: `Bearer ${staffToken}` };

  const otherStaff = await User.create({
    name: `Other Baker ${suffix}`,
    email: `other-baker-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    jobDesignation: "Apprentice Baker",
    hourlyLabourRate: 150,
    isActive: true,
  });
  const otherStaffToken = generateAccessToken(otherStaff);
  const otherStaffAuth = { Authorization: `Bearer ${otherStaffToken}` };

  const customer = await User.create({
    name: `Customer ${suffix}`,
    email: `customer-${suffix}@test.com`,
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
    isActive: true,
  });

  // Create Category & Ingredients
  const category = await Category.create({ name: `Test Cakes ${suffix}`, slug: `test-cakes-${suffix}` });
  const cocoa = await Ingredient.create({ name: `Dutch Cocoa ${suffix}`, slug: `cocoa-${suffix}`, unit: "g", minimumStock: 100 });
  const cream = await Ingredient.create({ name: `Dairy Cream ${suffix}`, slug: `cream-${suffix}`, unit: "ml", minimumStock: 500 });

  // Lots with sufficient stock
  const cocoaLot = await InventoryLot.create({
    ingredient: cocoa._id,
    lotNumber: `LOT-COCOA-${suffix}`,
    originalQuantity: 5000,
    remainingQuantity: 5000,
    unit: "g",
    unitCost: 0.8,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  const creamLot = await InventoryLot.create({
    ingredient: cream._id,
    lotNumber: `LOT-CREAM-${suffix}`,
    originalQuantity: 10000,
    remainingQuantity: 10000,
    unit: "ml",
    unitCost: 0.2,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  // Product & Variant
  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Chocolate Mousse Cake ${suffix}`,
    slug: `mousse-cake-${suffix}`,
    category: category._id,
    totalTimeMinutes: 45,
    electricityCostPerUnit: 5.0,
    packagingCostPerUnit: 4.0,
    variants: [{
      _id: variantId,
      name: "1 kg Whole Cake",
      quantity: 1,
      unit: "piece",
      price: 650,
      isActive: true,
      isAvailable: true,
    }],
    isActive: true,
    isAvailable: true,
  });

  const recipe = await Recipe.create({
    name: `Mousse Cake Recipe ${suffix}`,
    product: product._id,
    variant: variantId,
    revision: 1,
    expectedYield: 5,
    yieldUnit: "piece",
    recipeBatchQuantity: 5,
    preparationTime: 20,
    productionTime: 25,
    ingredients: [
      { ingredient: cocoa._id, name: cocoa.name, quantity: 200, unit: "g" },
      { ingredient: cream._id, name: cream.name, quantity: 500, unit: "ml" },
    ],
    isActive: true,
  });

  // Orders
  const mainOrder = await Order.create({
    orderNumber: `ORD-MAIN-${suffix}`,
    customer: customer._id,
    contactName: "Sita Sharma",
    contactPhone: "+91 98765 43210",
    status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
    paymentStatus: "PAYMENT_CONFIRMED",
    paymentMethod: "COD",
    orderType: "PICKUP",
    items: [{
      productId: product._id,
      variantId,
      productName: product.name,
      variantName: "1 kg Whole Cake",
      quantity: 5,
      unitPrice: 650,
      lineTotal: 3250,
    }],
    subtotal: 3250,
    total: 3250,
  });

  const cancelledOrder = await Order.create({
    orderNumber: `ORD-CANCELLED-${suffix}`,
    customer: customer._id,
    contactName: "Ramesh Gupta",
    contactPhone: "+91 91234 56789",
    status: CUSTOMER_ORDER_STATUSES.CANCELLED,
    paymentStatus: "REFUNDED",
    paymentMethod: "COD",
    orderType: "DELIVERY",
    items: [{
      productId: product._id,
      variantId,
      productName: product.name,
      variantName: "1 kg Whole Cake",
      quantity: 1,
      unitPrice: 650,
      lineTotal: 650,
    }],
    subtotal: 650,
    total: 650,
  });

  const deliveredOrder = await Order.create({
    orderNumber: `ORD-DELIVERED-${suffix}`,
    customer: customer._id,
    contactName: "Pooja Verma",
    contactPhone: "+91 99887 76655",
    status: CUSTOMER_ORDER_STATUSES.DELIVERED,
    paymentStatus: "PAYMENT_CONFIRMED",
    paymentMethod: "COD",
    orderType: "PICKUP",
    items: [{
      productId: product._id,
      variantId,
      productName: product.name,
      variantName: "1 kg Whole Cake",
      quantity: 2,
      unitPrice: 650,
      lineTotal: 1300,
    }],
    subtotal: 1300,
    total: 1300,
  });

  // Create Batch assigned to staff
  const batch = await ProductionBatch.create({
    batchNumber: `BATCH-REQ-${suffix}`,
    product: product._id,
    productVariant: variantId,
    productSnapshot: {
      productName: product.name,
      variantName: "1 kg Whole Cake",
      variantQuantity: 1,
      variantUnit: "piece",
    },
    recipe: recipe._id,
    recipeRevision: 1,
    recipeSnapshot: {
      expectedYield: 5,
      yieldUnit: "piece",
      recipeBatchQuantity: 5,
      ingredients: [
        { ingredient: cocoa._id, name: cocoa.name, quantity: 200, unit: "g" },
        { ingredient: cream._id, name: cream.name, quantity: 500, unit: "ml" },
      ],
      preparationTime: 20,
      productionTime: 25,
    },
    plannedQuantity: 5,
    unit: "piece",
    status: S.PLANNED,
    planningStatus: "APPROVED",
    relatedOrders: [mainOrder._id, cancelledOrder._id, deliveredOrder._id],
    syncOrderStatus: true,
    assignedWorkers: [{ worker: staff._id, task: "Bake Mousse Cakes" }],
    createdBy: owner._id,
  });

  const batchId = batch._id;
  let requisitionId = null;

  t.after(async () => {
    try {
      await ProductionBatch.deleteMany({ batchNumber: new RegExp(suffix) });
      await Order.deleteMany({ orderNumber: new RegExp(suffix) });
      await IngredientRequisition.deleteMany({ batch: batchId });
      await InventoryLot.deleteMany({ lotNumber: new RegExp(suffix) });
      await InventoryTransaction.deleteMany({ referenceId: batchId });
      await Recipe.deleteOne({ _id: recipe._id });
      await Product.deleteOne({ _id: product._id });
      await Category.deleteOne({ _id: category._id });
      await Ingredient.deleteMany({ _id: { $in: [cocoa._id, cream._id] } });
      await User.deleteMany({ email: new RegExp(suffix) });
    } catch {}
    await disconnectDb();
  });

  // 1. Staff accepts batch assignment
  await t.test("1. Staff accepts assigned batch", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${batchId}/accept`)
      .set(staffAuth)
      .send({
        batchNumber: batch.batchNumber,
        product: String(product._id),
        plannedQuantity: 5,
        relatedOrders: [String(mainOrder._id), String(cancelledOrder._id), String(deliveredOrder._id)],
        assignedWorkers: [String(staff._id)],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.batch.status, S.ACCEPTED);
  });

  // 2. Staff views required ingredients for batch
  await t.test("2. Staff inspects required ingredients with quantities and units", async () => {
    const res = await request(app)
      .get(`/api/v1/requisitions/batch/${batchId}/requirements`)
      .set(staffAuth);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.ingredients.length, 2);

    const cocoaReq = res.body.data.ingredients.find((i) => String(i.ingredientId) === String(cocoa._id));
    assert.ok(cocoaReq);
    assert.equal(cocoaReq.requiredQuantity, 200);
    assert.equal(cocoaReq.unit, "g");
    assert.equal(cocoaReq.status, "SUFFICIENT");

    // Other staff member cannot inspect another baker's batch
    const unauthRes = await request(app)
      .get(`/api/v1/requisitions/batch/${batchId}/requirements`)
      .set(otherStaffAuth);
    assert.equal(unauthRes.status, 403);
  });

  // 3. Staff submits ingredient requisition with specific quantities & units
  await t.test("3. Staff submits ingredient requisition with quantities & units", async () => {
    const res = await request(app)
      .post(`/api/v1/requisitions/batch/${batchId}`)
      .set(staffAuth)
      .send({
        items: [
          { ingredient: cocoa._id, name: cocoa.name, requestedQuantity: 200, unit: "g" },
          { ingredient: cream._id, name: cream.name, requestedQuantity: 500, unit: "ml" },
        ],
        notes: "Chilled dairy cream needed for morning bake",
      });
    assert.equal(res.status, 201);
    const reqData = res.body.data.requisition;
    requisitionId = reqData._id;
    assert.equal(reqData.status, REQUISITION_STATUS.PENDING);
    assert.equal(reqData.items.length, 2);
    assert.equal(reqData.items[0].requestedQuantity, 200);
    assert.equal(reqData.items[1].requestedQuantity, 500);

    // Duplicate requisition is prevented while active
    const dupRes = await request(app)
      .post(`/api/v1/requisitions/batch/${batchId}`)
      .set(staffAuth)
      .send({});
    assert.equal(dupRes.status, 409);
  });

  // 4. Staff cannot approve their own requisition (RBAC)
  await t.test("4. Production staff is strictly prohibited from self-approving requisition", async () => {
    const res = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/approve`)
      .set(staffAuth)
      .send({});
    assert.equal(res.status, 403);
  });

  // 5. Manager can reject requisition with reason; staff can resubmit
  await t.test("5. Manager rejects requisition with reason; staff submits revised requisition", async () => {
    const rejRes = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/reject`)
      .set(managerAuth)
      .send({ reason: "Fresh cream batch arriving at 10 AM, adjust timing" });
    assert.equal(rejRes.status, 200);
    assert.equal(rejRes.body.data.requisition.status, REQUISITION_STATUS.REJECTED);
    assert.equal(rejRes.body.data.requisition.rejectionReason, "Fresh cream batch arriving at 10 AM, adjust timing");

    // Notification created for requester
    const notif = await Notification.findOne({
      recipient: staff._id,
      relatedEntityId: requisitionId,
      type: "REQUISITION_REJECTED",
    });
    assert.ok(notif);

    // Staff submits revised requisition
    const revisedRes = await request(app)
      .post(`/api/v1/requisitions/batch/${batchId}`)
      .set(staffAuth)
      .send({
        items: [
          { ingredient: cocoa._id, name: cocoa.name, requestedQuantity: 200, unit: "g" },
          { ingredient: cream._id, name: cream.name, requestedQuantity: 500, unit: "ml" },
        ],
        notes: "Revised: Using pre-stocked chilled cream from shelf B",
      });
    assert.equal(revisedRes.status, 201);
    requisitionId = revisedRes.body.data.requisition._id;
  });

  // 7. Manager reviews and approves requisition with stock validation
  await t.test("7. Manager reviews and approves requisition", async () => {
    const appRes = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/approve`)
      .set(managerAuth)
      .send({
        notes: "Approved for morning pastry line",
      });
    assert.equal(appRes.status, 200);
    assert.equal(appRes.body.data.requisition.status, REQUISITION_STATUS.APPROVED);
    assert.equal(appRes.body.data.requisition.items[0].approvedQuantity, 200);
    assert.equal(appRes.body.data.requisition.items[1].approvedQuantity, 500);
  });

  // 8. Manager physically issues ingredients: FIFO deduction & transactions
  await t.test("8. Manager issues ingredients: inventory lots deducted, batch VERIFIED and CONSUMED", async () => {
    const issueRes = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/issue`)
      .set(managerAuth)
      .send({});
    assert.equal(issueRes.status, 200);
    assert.equal(issueRes.body.data.requisition.status, REQUISITION_STATUS.ISSUED);

    // Verify inventory lots deducted
    const updatedCocoaLot = await InventoryLot.findById(cocoaLot._id);
    assert.equal(updatedCocoaLot.remainingQuantity, 4800); // 5000 - 200

    const updatedCreamLot = await InventoryLot.findById(creamLot._id);
    assert.equal(updatedCreamLot.remainingQuantity, 9500); // 10000 - 500

    // Verify batch status is now VERIFIED with consumptionStatus CONSUMED
    const updatedBatch = await ProductionBatch.findById(batchId);
    assert.equal(updatedBatch.status, S.VERIFIED);
    assert.equal(updatedBatch.consumptionStatus, "CONSUMED");
    assert.equal(updatedBatch.consumedIngredients.length, 2);

    // Repeated issuance is idempotent and does not double-deduct
    const reIssueRes = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/issue`)
      .set(managerAuth)
      .send({});
    assert.equal(reIssueRes.status, 200);

    const reCheckedCocoaLot = await InventoryLot.findById(cocoaLot._id);
    assert.equal(reCheckedCocoaLot.remainingQuantity, 4800); // Unchanged!
  });

  // 9. Production starts: order moves to IN_PRODUCTION (not READY)
  await t.test("9. Production start moves order to IN_PRODUCTION, NOT READY", async () => {
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/start`)
      .set(staffAuth);
    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.data.batch.status, S.IN_PRODUCTION);

    // Main order is now IN_PRODUCTION
    const orderInProd = await Order.findById(mainOrder._id);
    assert.equal(orderInProd.status, CUSTOMER_ORDER_STATUSES.IN_PRODUCTION);

    // Cancelled and delivered orders must NOT be changed
    const cancelled = await Order.findById(cancelledOrder._id);
    assert.equal(cancelled.status, CUSTOMER_ORDER_STATUSES.CANCELLED);

    const delivered = await Order.findById(deliveredOrder._id);
    assert.equal(delivered.status, CUSTOMER_ORDER_STATUSES.DELIVERED);
  });

  // 10. Intermediate baking completion: batch PACKAGING, order remains IN_PRODUCTION (not READY)
  await t.test("10. Intermediate baking step moves to PACKAGING; order remains IN_PRODUCTION", async () => {
    const completeRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/complete`)
      .set(staffAuth)
      .send({
        producedQuantity: 5,
        usableQuantity: 5,
        wastageQuantity: 0,
        productionNotes: "Baked to perfection",
      });
    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.data.batch.status, S.PACKAGING);

    // Order must STILL be IN_PRODUCTION, not READY!
    const orderCheck = await Order.findById(mainOrder._id);
    assert.equal(orderCheck.status, CUSTOMER_ORDER_STATUSES.IN_PRODUCTION);
  });

  // 11. Packaging complete: batch PACKAGED, order transitions to READY!
  await t.test("11. Packaging complete moves order to READY in owner dashboard", async () => {
    const packRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/package`)
      .set(staffAuth)
      .send({ packagedQuantity: 5 });
    assert.equal(packRes.status, 200);
    assert.equal(packRes.body.data.batch.status, S.PACKAGED);

    // Linked main order is authoritatively READY!
    const readyOrder = await Order.findById(mainOrder._id);
    assert.equal(readyOrder.status, CUSTOMER_ORDER_STATUSES.READY);

    // Customer notified of READY
    const readyNotif = await Notification.findOne({
      recipient: customer._id,
      dedupeKey: `order:${mainOrder._id}:READY`,
    });
    assert.ok(readyNotif);

    // Cancelled and delivered orders remain strictly unchanged!
    const cancelled = await Order.findById(cancelledOrder._id);
    assert.equal(cancelled.status, CUSTOMER_ORDER_STATUSES.CANCELLED);

    const delivered = await Order.findById(deliveredOrder._id);
    assert.equal(delivered.status, CUSTOMER_ORDER_STATUSES.DELIVERED);
  });

  // 12. Finalizing batch maintains READY order status
  await t.test("12. Finalizing batch maintains READY status on linked order", async () => {
    const finRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/finalize`)
      .set(staffAuth);
    assert.equal(finRes.status, 200);
    assert.equal(finRes.body.data.batch.status, S.COMPLETED);

    const orderCheck = await Order.findById(mainOrder._id);
    assert.equal(orderCheck.status, CUSTOMER_ORDER_STATUSES.READY);
  });
  } catch (err) {
    console.error("TEST TOP LEVEL ERROR:", err);
    throw err;
  }
});
