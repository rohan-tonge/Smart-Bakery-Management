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
import IngredientRequisition from "../src/models/ingredientRequisition.model.js";
import Order from "../src/models/order.model.js";
import Notification from "../src/models/notification.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";

test("Order-to-production workflow with ingredient requisitions", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF, USER_ROLES.CUSTOMER]) {
    const user = await User.create({
      name: `Req ${role}`,
      email: `${role.toLowerCase()}-${suffix}@req-test.com`,
      password: "Password123!",
      role,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const otherStaff = await User.create({
    name: "Other Baker",
    email: `other-baker-${suffix}@req-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
  });
  const otherStaffToken = generateAccessToken(otherStaff);

  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });
  const otherStaffAuth = { Authorization: `Bearer ${otherStaffToken}` };
  const staffAuth = auth(USER_ROLES.PRODUCTION_STAFF);
  const managerAuth = auth(USER_ROLES.MANAGER);

  const category = await Category.create({ name: `Req Category ${suffix}`, slug: `req-cat-${suffix}` });
  const product = await Product.create({
    name: `Artisan Croissant ${suffix}`,
    slug: `croissant-${suffix}`,
    category: category._id,
    variants: [{ name: "Box of 6", quantity: 6, unit: "piece", price: 250 }],
  });
  const variantId = product.variants[0]._id;

  const butter = await Ingredient.create({ name: `Butter ${suffix}`, slug: `butter-${suffix}`, unit: "g", minimumStock: 100 });
  const flour = await Ingredient.create({ name: `Flour ${suffix}`, slug: `flour-${suffix}`, unit: "kg", minimumStock: 5 });

  const butterLot = await InventoryLot.create({
    ingredient: butter._id,
    lotNumber: `LOT-BUTTER-${suffix}`,
    originalQuantity: 5000,
    remainingQuantity: 5000,
    unit: "g",
    unitCost: 0.5,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });
  const flourLot = await InventoryLot.create({
    ingredient: flour._id,
    lotNumber: `LOT-FLOUR-${suffix}`,
    originalQuantity: 20,
    remainingQuantity: 20,
    unit: "kg",
    unitCost: 40,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    ingredients: [
      { ingredient: butter._id, quantity: 250, unit: "g" },
      { ingredient: flour._id, quantity: 0.5, unit: "kg" },
    ],
    expectedYield: 6,
    yieldUnit: "piece",
    preparationTime: 20,
    productionTime: 40,
  });

  const order = await Order.create({
    orderNumber: `ORD-REQ-${suffix}`,
    customer: users[USER_ROLES.CUSTOMER].user._id,
    items: [{
      productId: product._id,
      variantId,
      productName: product.name,
      variantName: "Box of 6",
      quantity: 1,
      unitPrice: 250,
      lineTotal: 250,
    }],
    subtotal: 250,
    total: 250,
    orderType: "PICKUP",
    contactName: "Test Customer",
    contactPhone: "9876543210",
    status: "CONFIRMED",
    paymentStatus: "PAYMENT_CONFIRMED",
  });

  let batchId;
  let requisitionId;

  t.after(async () => {
    await IngredientRequisition.deleteMany({ requester: { $in: [users[USER_ROLES.PRODUCTION_STAFF].user._id, otherStaff._id] } });
    await ProductionBatch.deleteMany({ createdBy: { $in: [users[USER_ROLES.OWNER].user._id, users[USER_ROLES.MANAGER].user._id] } });
    await InventoryTransaction.deleteMany({ ingredient: { $in: [butter._id, flour._id] } });
    await InventoryLot.deleteMany({ _id: { $in: [butterLot._id, flourLot._id] } });
    await FinishedProductStock.deleteMany({ product: product._id });
    await Notification.deleteMany({ recipient: { $in: [users[USER_ROLES.CUSTOMER].user._id, users[USER_ROLES.PRODUCTION_STAFF].user._id, users[USER_ROLES.MANAGER].user._id] } });
    await Recipe.deleteOne({ _id: recipe._id });
    await Order.deleteOne({ _id: order._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await Ingredient.deleteMany({ _id: { $in: [butter._id, flour._id] } });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@req-test\\.com$`) });
    await disconnectDb();
  });

  await t.test("1. Manager assigns confirmed order to active production staff", async () => {
    // Non-manager cannot assign
    const nonManager = await request(app)
      .post(`/api/v1/orders/${order._id}/assign`)
      .set(staffAuth)
      .send({ workers: [users[USER_ROLES.PRODUCTION_STAFF].user._id] });
    assert.equal(nonManager.status, 403);

    // Empty workers fails
    const emptyWorkers = await request(app)
      .post(`/api/v1/orders/${order._id}/assign`)
      .set(managerAuth)
      .send({ workers: [] });
    assert.equal(emptyWorkers.status, 400);

    // Valid assignment
    const assignRes = await request(app)
      .post(`/api/v1/orders/${order._id}/assign`)
      .set(managerAuth)
      .send({ workers: [users[USER_ROLES.PRODUCTION_STAFF].user._id] });
    assert.equal(assignRes.status, 201, assignRes.body.message);
    assert.ok(assignRes.body.data.batches.length > 0);

    const batch = assignRes.body.data.batches[0];
    batchId = batch._id;
    assert.equal(batch.status, "PLANNED");
    assert.equal(batch.syncOrderStatus, true);
    assert.equal(batch.assignedWorkers[0].worker, String(users[USER_ROLES.PRODUCTION_STAFF].user._id));

    // Production staff received assignment notification
    const staffNotifs = await Notification.find({
      recipient: users[USER_ROLES.PRODUCTION_STAFF].user._id,
      type: "PRODUCTION_ASSIGNED",
    });
    assert.ok(staffNotifs.length > 0);
  });

  await t.test("2. Assigned staff accepts production batch assignment", async () => {
    // Unassigned staff cannot accept
    const wrongStaff = await request(app)
      .post(`/api/v1/production/batches/${batchId}/accept`)
      .set(otherStaffAuth)
      .send({});
    assert.equal(wrongStaff.status, 403);

    // Assigned staff accepts
    const acceptRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/accept`)
      .set(staffAuth)
      .send({});
    assert.equal(acceptRes.status, 200, acceptRes.body.message);
    assert.equal(acceptRes.body.data.batch.status, "ACCEPTED");

    // Manager received acceptance notification
    const mgrNotifs = await Notification.find({
      recipient: users[USER_ROLES.MANAGER].user._id,
      type: "PRODUCTION_ACCEPTED",
    });
    assert.ok(mgrNotifs.length > 0);
  });

  await t.test("3. Staff inspects required ingredients with zero financial leakage", async () => {
    // Unassigned staff cannot inspect
    const wrongStaff = await request(app)
      .get(`/api/v1/requisitions/batch/${batchId}/requirements`)
      .set(otherStaffAuth);
    assert.equal(wrongStaff.status, 403);

    const reqsRes = await request(app)
      .get(`/api/v1/requisitions/batch/${batchId}/requirements`)
      .set(staffAuth);
    assert.equal(reqsRes.status, 200, reqsRes.body.message);
    const data = reqsRes.body.data;

    assert.equal(data.batchId, batchId);
    assert.equal(data.totalDuration, 60); // 20 + 40 minutes
    assert.equal(data.ingredients.length, 2);

    // Verify zero financial details leaked to staff
    for (const item of data.ingredients) {
      assert.equal(item.unitCost, undefined);
      assert.equal(item.costPaise, undefined);
      assert.equal(item.unitCostSnapshot, undefined);
      assert.equal(item.vendor, undefined);
      assert.equal(item.purchase, undefined);
      assert.ok(item.requiredQuantity > 0);
      assert.ok(item.unit);
      assert.ok(["SUFFICIENT", "INSUFFICIENT"].includes(item.status));
    }
  });

  await t.test("4. Staff creates ingredient requisition and RBAC blocks self-approval", async () => {
    // Unassigned staff cannot submit requisition
    const wrongStaff = await request(app)
      .post(`/api/v1/requisitions/batch/${batchId}`)
      .set(otherStaffAuth)
      .send({
        items: [
          { ingredientId: String(butter._id), requestedQuantity: 250, unit: "g" },
          { ingredientId: String(flour._id), requestedQuantity: 0.5, unit: "kg" },
        ],
      });
    assert.equal(wrongStaff.status, 403);

    // Assigned staff submits requisition
    const submitRes = await request(app)
      .post(`/api/v1/requisitions/batch/${batchId}`)
      .set(staffAuth)
      .send({
        items: [
          { ingredientId: String(butter._id), requestedQuantity: 250, unit: "g" },
          { ingredientId: String(flour._id), requestedQuantity: 0.5, unit: "kg" },
        ],
        notes: "Ingredients for morning bake",
      });
    assert.equal(submitRes.status, 201, submitRes.body.message);
    const req = submitRes.body.data.requisition;
    requisitionId = req._id;
    assert.equal(req.status, "PENDING");
    assert.ok(req.requisitionNumber.startsWith("REQ-"));
    assert.equal(req.items.length, 2);

    // Duplicate requisition blocked
    const duplicate = await request(app)
      .post(`/api/v1/requisitions/batch/${batchId}`)
      .set(staffAuth)
      .send({
        items: [
          { ingredientId: String(butter._id), requestedQuantity: 250, unit: "g" },
        ],
      });
    assert.equal(duplicate.status, 409);

    // Staff cannot approve their own requisition
    const selfApprove = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/approve`)
      .set(staffAuth)
      .send({});
    assert.equal(selfApprove.status, 403);

    // Staff cannot issue their own requisition
    const selfIssue = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/issue`)
      .set(staffAuth)
      .send({});
    assert.equal(selfIssue.status, 403);
  });

  await t.test("5. Unauthorized role cannot start production", async () => {
    const unauthorizedStart = await request(app)
      .post(`/api/v1/production/batches/${batchId}/start`)
      .set(auth(USER_ROLES.CUSTOMER));
    assert.equal(unauthorizedStart.status, 403);
  });

  await t.test("6. Manager approves requisition with optional adjustments", async () => {
    const approveRes = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/approve`)
      .set(managerAuth)
      .send({
        notes: "Approved with standard recipe portions",
      });
    assert.equal(approveRes.status, 200, approveRes.body.message);
    assert.equal(approveRes.body.data.requisition.status, "APPROVED");
  });

  await t.test("7. Manager issues ingredients: FIFO deduction and ledger recorded", async () => {
    const initialButterRemaining = (await InventoryLot.findById(butterLot._id)).remainingQuantity;
    const initialFlourRemaining = (await InventoryLot.findById(flourLot._id)).remainingQuantity;

    const issueRes = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/issue`)
      .set(managerAuth)
      .send({});
    assert.equal(issueRes.status, 200, issueRes.body.message);
    const issuedReq = issueRes.body.data.requisition;
    assert.equal(issuedReq.status, "ISSUED");

    // Verify lots deducted
    const updatedButter = await InventoryLot.findById(butterLot._id);
    const updatedFlour = await InventoryLot.findById(flourLot._id);
    assert.equal(updatedButter.remainingQuantity, initialButterRemaining - 250);
    assert.equal(updatedFlour.remainingQuantity, initialFlourRemaining - 0.5);

    // Verify inventory transactions recorded
    const transactions = await InventoryTransaction.find({
      referenceType: "PRODUCTION",
      referenceId: batchId,
      direction: "OUT",
    });
    assert.equal(transactions.length, 2);

    // Verify batch status is now VERIFIED and consumptionStatus is CONSUMED
    const updatedBatch = await ProductionBatch.findById(batchId);
    assert.equal(updatedBatch.status, "VERIFIED");
    assert.equal(updatedBatch.verificationStatus, "VERIFIED");
    assert.equal(updatedBatch.consumptionStatus, "CONSUMED");

    // Issuing again is idempotent
    const reIssue = await request(app)
      .post(`/api/v1/requisitions/${requisitionId}/issue`)
      .set(managerAuth)
      .send({});
    assert.equal(reIssue.status, 200);

    // Calling legacy consume returns 409 because already CONSUMED
    const doubleConsume = await request(app)
      .post(`/api/v1/production/batches/${batchId}/consume`)
      .set(staffAuth);
    assert.equal(doubleConsume.status, 409);
  });

  await t.test("8. Production starts and updates order to IN_PRODUCTION; completion updates order to READY", async () => {
    // Staff starts production
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/start`)
      .set(staffAuth);
    assert.equal(startRes.status, 200, startRes.body.message);
    assert.equal(startRes.body.data.batch.status, "IN_PRODUCTION");

    // Related customer order transitioned to IN_PRODUCTION!
    const inProdOrder = await Order.findById(order._id);
    assert.equal(inProdOrder.status, "IN_PRODUCTION");

    // Customer notified of IN_PRODUCTION
    const custInProdNotif = await Notification.findOne({
      recipient: users[USER_ROLES.CUSTOMER].user._id,
      dedupeKey: `order:${order._id}:IN_PRODUCTION`,
    });
    assert.ok(custInProdNotif);

    // Complete baking
    const completeRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/complete`)
      .set(staffAuth)
      .send({ producedQuantity: 6, usableQuantity: 6, wastageQuantity: 0, productionNotes: "Perfect batch" });
    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.data.batch.status, "PACKAGING");

    // Packaging
    const packRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/package`)
      .set(staffAuth)
      .send({ packagedQuantity: 6 });
    assert.equal(packRes.status, 200);
    assert.equal(packRes.body.data.batch.status, "PACKAGED");

    // Finalize batch
    const finalizeRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/finalize`)
      .set(staffAuth);
    assert.equal(finalizeRes.status, 200);
    assert.equal(finalizeRes.body.data.batch.status, "COMPLETED");

    // Related customer order transitioned to READY!
    const readyOrder = await Order.findById(order._id);
    assert.equal(readyOrder.status, "READY");

    // Customer notified of READY
    const custReadyNotif = await Notification.findOne({
      recipient: users[USER_ROLES.CUSTOMER].user._id,
      dedupeKey: `order:${order._id}:READY`,
    });
    assert.ok(custReadyNotif);
  });
});
