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
import Payment from "../src/models/payment.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import Notification from "../src/models/notification.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";

test("Staff Labour Rates and Actual Batch Costing Workflow", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create users: Owner, Manager, Staff 1, Staff 2, Customer
  const users = {};
  const owner = await User.create({
    name: `Owner ${suffix}`,
    email: `owner-${suffix}@labour-test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER,
  });
  users.OWNER = { user: owner, token: generateAccessToken(owner) };

  const manager = await User.create({
    name: `Manager ${suffix}`,
    email: `manager-${suffix}@labour-test.com`,
    password: "Password123!",
    role: USER_ROLES.MANAGER,
  });
  users.MANAGER = { user: manager, token: generateAccessToken(manager) };

  const customer = await User.create({
    name: `Customer ${suffix}`,
    email: `cust-${suffix}@labour-test.com`,
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
  });
  users.CUSTOMER = { user: customer, token: generateAccessToken(customer) };

  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  // Catalog setup
  const category = await Category.create({
    name: `Labour Test Cat ${suffix}`,
    slug: `labour-cat-${suffix}`,
  });
  const product = await Product.create({
    name: `Labour Sourdough ${suffix}`,
    slug: `labour-sourdough-${suffix}`,
    category: category._id,
    variants: [{ name: "Loaf 500g", quantity: 1, unit: "piece", price: 120 }],
  });
  const variantId = product.variants[0]._id;

  const ingredient = await Ingredient.create({
    name: `Rye Flour ${suffix}`,
    slug: `rye-flour-${suffix}`,
    unit: "kg",
  });
  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    ingredients: [{ ingredient: ingredient._id, quantity: 10, unit: "kg" }],
    expectedYield: 20,
    yieldUnit: "piece",
  });

  const lot = await InventoryLot.create({
    ingredient: ingredient._id,
    lotNumber: `LOT-RYE-${suffix}`,
    originalQuantity: 100,
    remainingQuantity: 100,
    unit: "kg",
    unitCost: 50,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  let staff1Id;
  let staff1Token;
  let staff2Id;
  let staff2Token;
  let batchId;
  let draftBatchId;
  let orderId;

  t.after(async () => {
    const batches = await ProductionBatch.find({
      $or: [
        { product: product._id },
        { createdBy: users.OWNER?.user?._id },
      ],
    });
    const bIds = batches.map((b) => b._id);
    await Notification.deleteMany({
      $or: [
        { relatedEntityId: { $in: bIds } },
        { recipient: { $in: [staff1Id, staff2Id] } },
      ],
    });
    await ProductionBatch.deleteMany({
      $or: [
        { product: product._id },
        { createdBy: users.OWNER?.user?._id },
      ],
    });
    await InventoryLot.deleteMany({ lotNumber: new RegExp(suffix) });
    await Ingredient.deleteOne({ _id: ingredient._id });
    await Recipe.deleteOne({ _id: recipe._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    if (orderId) {
      await Payment.deleteMany({ order: orderId });
      await Order.deleteOne({ _id: orderId });
    }
    await FinishedProductStock.deleteMany({ product: product._id });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@labour-test\\.com$`) });
    await disconnectDb();
  });

  // 1. Staff registration with hourlyLabourRate
  await t.test("Owner registers production staff with required hourlyLabourRate", async () => {
    // Attempt invalid rates
    const invalidNegative = await request(app)
      .post("/api/v1/workers")
      .set(auth("OWNER"))
      .send({
        name: "Chef Negative",
        email: `neg-${suffix}@labour-test.com`,
        password: "Password123!",
        hourlyLabourRate: -50,
      });
    assert.equal(invalidNegative.status, 400);

    // Register Staff 1 with rate 150/hr
    const createRes = await request(app)
      .post("/api/v1/workers")
      .set(auth("OWNER"))
      .send({
        name: "Baker John",
        email: `john-${suffix}@labour-test.com`,
        password: "Password123!",
        jobDesignation: "Head Baker",
        hourlyLabourRate: 150,
      });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.data.worker.hourlyLabourRate, 150);
    assert.equal(createRes.body.data.worker.role, USER_ROLES.PRODUCTION_STAFF);
    staff1Id = createRes.body.data.worker._id;

    const staff1User = await User.findById(staff1Id);
    staff1Token = generateAccessToken(staff1User);

    // Register Staff 2 with rate 120/hr
    const createRes2 = await request(app)
      .post("/api/v1/workers")
      .set(auth("OWNER"))
      .send({
        name: "Baker Sarah",
        email: `sarah-${suffix}@labour-test.com`,
        password: "Password123!",
        jobDesignation: "Pastry Apprentice",
        hourlyLabourRate: 120,
      });
    assert.equal(createRes2.status, 201);
    staff2Id = createRes2.body.data.worker._id;
    const staff2User = await User.findById(staff2Id);
    staff2Token = generateAccessToken(staff2User);
  });

  // 2. Authorization rules on labour rates
  await t.test("Staff cannot modify their own or others' labour rates", async () => {
    // Staff 1 tries to update their own rate
    const staffAttempt = await request(app)
      .patch(`/api/v1/workers/${staff1Id}`)
      .set({ Authorization: `Bearer ${staff1Token}` })
      .send({ hourlyLabourRate: 500 });
    assert.equal(staffAttempt.status, 403);

    // Owner can update the rate
    const ownerUpdate = await request(app)
      .patch(`/api/v1/workers/${staff1Id}`)
      .set(auth("OWNER"))
      .send({ hourlyLabourRate: 180 });
    assert.equal(ownerUpdate.status, 200);
    assert.equal(ownerUpdate.body.data.worker.hourlyLabourRate, 180);
  });

  // 3. Batch creation snapshots labour rate
  await t.test("Batch assignment captures hourlyRateSnapshot from worker record", async () => {
    const createBatchRes = await request(app)
      .post("/api/v1/production/batches")
      .set(auth("OWNER"))
      .send({
        product: String(product._id),
        productVariant: String(variantId),
        plannedQuantity: 20,
        assignedWorkers: [
          { worker: staff1Id, task: "Dough Mixing" },
          { worker: staff2Id, task: "Oven Baking" },
        ],
      });
    assert.equal(createBatchRes.status, 201);
    batchId = createBatchRes.body.data.batch._id;

    const batch = await ProductionBatch.findById(batchId);
    assert.equal(batch.assignedWorkers.length, 2);

    const w1 = batch.assignedWorkers.find((w) => String(w.worker) === staff1Id);
    const w2 = batch.assignedWorkers.find((w) => String(w.worker) === staff2Id);

    assert.equal(w1.hourlyRateSnapshot, 180); // Snapshotted from John's current rate
    assert.equal(w2.hourlyRateSnapshot, 120); // Snapshotted from Sarah's current rate
    assert.equal(w1.actualHours, null);
    assert.equal(w2.actualHours, null);
  });

  // 4. Rate snapshot immutability
  await t.test("Subsequent changes to staff rate do not alter batch hourlyRateSnapshot", async () => {
    // Owner changes John's rate from 180 to 250
    const updateRes = await request(app)
      .patch(`/api/v1/workers/${staff1Id}`)
      .set(auth("OWNER"))
      .send({ hourlyLabourRate: 250 });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.worker.hourlyLabourRate, 250);

    // Verify batch snapshot is still 180
    const batch = await ProductionBatch.findById(batchId);
    const w1 = batch.assignedWorkers.find((w) => String(w.worker) === staff1Id);
    assert.equal(w1.hourlyRateSnapshot, 180);
  });

  // 5. Recording actual hours worked
  await t.test("Staff can record their own hours, and owner can update any worker hours", async () => {
    // Staff 1 records 2.5 hours on their own assignment via /production/batches/:id/assignment
    const staffSelfRecord = await request(app)
      .patch(`/api/v1/production/batches/${batchId}/assignment`)
      .set({ Authorization: `Bearer ${staff1Token}` })
      .send({ actualHours: 2.5 });
    assert.equal(staffSelfRecord.status, 200);

    // Negative hours should be rejected
    const invalidHours = await request(app)
      .patch(`/api/v1/production/batches/${batchId}/assignment`)
      .set({ Authorization: `Bearer ${staff1Token}` })
      .send({ actualHours: -3 });
    assert.equal(invalidHours.status, 400);

    // Staff 1 tries to modify Staff 2's assignment -> blocked with 403
    const staffCrossUpdate = await request(app)
      .patch(`/api/v1/production/batches/${batchId}/assignment`)
      .set({ Authorization: `Bearer ${staff1Token}` })
      .send({ workerId: staff2Id, actualHours: 5.0 });
    assert.equal(staffCrossUpdate.status, 403);

    // Owner records 1.5 hours for Sarah
    const ownerRecordSarah = await request(app)
      .patch(`/api/v1/production/batches/${batchId}/assignment`)
      .set(auth("OWNER"))
      .send({ workerId: staff2Id, actualHours: 1.5 });
    assert.equal(ownerRecordSarah.status, 200);

    const verifiedBatch = await ProductionBatch.findById(batchId);
    const w1 = verifiedBatch.assignedWorkers.find((w) => String(w.worker) === staff1Id);
    const w2 = verifiedBatch.assignedWorkers.find((w) => String(w.worker) === staff2Id);
    assert.equal(w1.actualHours, 2.5);
    assert.equal(w2.actualHours, 1.5);
  });

  // 6. Cost review and missing checklist before completion
  await t.test("Cost review API reports missing requirements and prevents premature finalization", async () => {
    // Batch is still in PLANNED status, ingredients not consumed
    const costReview = await request(app)
      .get(`/api/v1/production/batches/${batchId}/cost`)
      .set(auth("OWNER"));
    assert.equal(costReview.status, 200);
    assert.equal(costReview.body.data.cost.status, "NOT_READY");
    assert.ok(costReview.body.data.cost.incomplete.length > 0);

    // Finalize should be rejected because batch has incomplete requirements
    const prematureFinalize = await request(app)
      .post(`/api/v1/production/batches/${batchId}/cost/finalize`)
      .set(auth("OWNER"))
      .send({});
    assert.equal(prematureFinalize.status, 409);
  });

  // 7. Complete batch with consumed ingredients and verify exact labour calculation
  await t.test("Batch costing calculates exact labour and component costs", async () => {
    // Mark batch completed with consumed ingredients: 10 kg @ 50/kg = 500 rupees = 50000 paise
    await ProductionBatch.updateOne(
      { _id: batchId },
      {
        $set: {
          consumedIngredients: [
            {
              ingredient: ingredient._id,
              ingredientName: ingredient.name,
              lot: lot._id,
              lotNumber: lot.lotNumber,
              quantity: 10,
              unit: "kg",
              unitCostSnapshot: 50,
            },
          ],
          consumptionStatus: "CONSUMED",
          status: "COMPLETED",
          producedQuantity: 20,
          usableQuantity: 20,
          wastageQuantity: 0,
          actualStartTime: new Date(),
          actualCompletionTime: new Date(),
        },
      }
    );

    // Get cost review
    // Expected Labour:
    // John: 2.5 hrs × 180 = 450 rupees = 45000 paise
    // Sarah: 1.5 hrs × 120 = 180 rupees = 18000 paise
    // Total Labour: 630 rupees = 63000 paise
    // Ingredients: 10 × 50 = 500 rupees = 50000 paise
    // Total Cost: 1130 rupees = 113000 paise
    // Unit Cost: 1130 / 20 = 56.50 rupees
    const costReview = await request(app)
      .get(`/api/v1/production/batches/${batchId}/cost`)
      .set(auth("OWNER"));
    assert.equal(costReview.status, 200);
    const cost = costReview.body.data.cost;

    assert.equal(cost.incomplete.length, 0);
    assert.equal(cost.status, "READY_TO_FINALIZE");
    assert.equal(cost.labourCost, 630);
    assert.equal(cost.ingredientCost, 500);
    assert.equal(cost.totalCost, 1130);
    assert.equal(cost.costPerUsableItem, 56.5);
  });

  // 8. Cost Finalization: permissions, lock, and immutability
  await t.test("Cost finalization requires owner role, locks batch, and enables analytics", async () => {
    // Production staff cannot finalize
    const staffFinalize = await request(app)
      .post(`/api/v1/production/batches/${batchId}/cost/finalize`)
      .set({ Authorization: `Bearer ${staff1Token}` })
      .send({});
    assert.equal(staffFinalize.status, 403);

    // Customer cannot finalize
    const custFinalize = await request(app)
      .post(`/api/v1/production/batches/${batchId}/cost/finalize`)
      .set(auth("CUSTOMER"))
      .send({});
    assert.equal(custFinalize.status, 403);

    // Owner finalizes cost with optional packaging cost of 20 rupees and 50 rupees delivery fuel expense
    const finalizeRes = await request(app)
      .post(`/api/v1/production/batches/${batchId}/cost/finalize`)
      .set(auth("OWNER"))
      .send({
        packagingCost: 20,
        expenses: [{ description: "Oven gas / fuel", amount: 50, notes: "Bake cycle run" }],
      });
    assert.equal(finalizeRes.status, 200);

    const finalizedCost = finalizeRes.body.data.cost;
    assert.equal(finalizedCost.status, "FINALIZED");
    // New Total: 1130 + 20 (packaging) + 50 (fuel) = 1200 rupees
    assert.equal(finalizedCost.totalCost, 1200);
    assert.equal(finalizedCost.costPerUsableItem, 60);

    // Verify batch is locked against assignment updates
    const modifyAttempt = await request(app)
      .patch(`/api/v1/production/batches/${batchId}/assignment`)
      .set(auth("OWNER"))
      .send({ workerId: staff1Id, actualHours: 10 });
    assert.equal(modifyAttempt.status, 409); // Conflict: immutable once finalized

    // Verify re-finalizing is rejected with conflict
    const refinalizeAttempt = await request(app)
      .post(`/api/v1/production/batches/${batchId}/cost/finalize`)
      .set(auth("OWNER"))
      .send({});
    assert.equal(refinalizeAttempt.status, 409);

    // Connect with Sales & Analytics: Create fulfilled order for this batch
    const order = await Order.create({
      orderNumber: `ORD-LABOUR-${suffix}`,
      customer: users.CUSTOMER.user._id,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Loaf 500g",
          quantity: 20,
          unitPrice: 120,
          lineTotal: 2400,
        },
      ],
      subtotal: 2400,
      total: 2400,
      orderType: "PICKUP",
      contactName: "Cost Customer",
      contactPhone: "9876543210",
      status: "DELIVERED",
      paymentSummary: { status: "CAPTURED", provider: "RAZORPAY" },
    });
    orderId = order._id;

    await ProductionBatch.updateOne(
      { _id: batchId },
      { $set: { relatedOrders: [order._id] } }
    );

    await Payment.create({
      order: order._id,
      customer: users.CUSTOMER.user._id,
      amount: 240000,
      currency: "INR",
      status: "CAPTURED",
      providerOrderId: `rp-${suffix}`,
      providerPaymentId: `pay-${suffix}`,
    });

    // Query Sales & Analytics summary API
    const analyticsRes = await request(app)
      .get("/api/v1/analytics/summary")
      .set(auth("OWNER"));
    assert.equal(analyticsRes.status, 200);
    const summary = analyticsRes.body.data.summary;

    // COGS should be computable or partial since our batch is finalized!
    assert.ok(
      summary.cogsStatus === "COMPUTABLE" || summary.cogsStatus === "PARTIAL",
      `Expected cogsStatus to be COMPUTABLE or PARTIAL, got ${summary.cogsStatus}`
    );
    assert.ok(summary.grossProfit != null);
  });

  // 9. Draft cost saving allows packaging & expenses to be persisted and previewed without locking batch
  await t.test("Draft cost saving allows packaging & expenses to be persisted and previewed without locking batch", async () => {
    // Create an unfinalized completed batch
    const draftBatch = await ProductionBatch.create({
      batchNumber: `BATCH-DRAFT-${suffix}`,
      product: product._id,
      productVariant: variantId,
      productSnapshot: {
        productName: product.name,
        variantName: "Loaf 500g",
        variantQuantity: 1,
        variantUnit: "piece",
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        recipeBatchQuantity: 1,
        expectedYield: 20,
        yieldUnit: "piece",
        labourCostPerMinute: 2,
        powerCostPerMinute: 1,
        packagingCostPerUnit: 1,
        ingredients: [
          {
            ingredient: ingredient._id,
            name: ingredient.name,
            quantity: 10,
            unit: "kg",
          },
        ],
      },
      plannedQuantity: 20,
      producedQuantity: 20,
      usableQuantity: 20,
      wastageQuantity: 0,
      unit: "piece",
      status: "COMPLETED",
      consumptionStatus: "CONSUMED",
      consumedIngredients: [
        {
          ingredient: ingredient._id,
          ingredientName: ingredient.name,
          lot: lot._id,
          lotNumber: lot.lotNumber,
          quantity: 10,
          unit: "kg",
          unitCostSnapshot: 50,
        },
      ],
      assignedWorkers: [
        { worker: staff1Id, task: "Baking", hourlyRateSnapshot: 150, actualHours: 2.0 },
      ],
      costing: { status: "NOT_FINALIZED" },
      createdBy: owner._id,
    });
    draftBatchId = draftBatch._id;

    // Save draft packaging and expenses
    const saveDraftRes = await request(app)
      .patch(`/api/v1/production/batches/${draftBatch._id}/cost/draft`)
      .set(auth("OWNER"))
      .send({
        packagingCost: 45,
        expenses: [{ description: "Sanitation & clean down", amount: 35, notes: "End of shift" }],
      });
    assert.equal(saveDraftRes.status, 200);

    // Verify batch is STILL NOT_FINALIZED
    const refreshed = await ProductionBatch.findById(draftBatch._id);
    assert.equal(refreshed.costing.status, "NOT_FINALIZED");
    assert.equal(refreshed.costing.packagingCostPaise, 4500);
    assert.equal(refreshed.costing.expenses.length, 1);
    assert.equal(refreshed.costing.expenses[0].amountPaise, 3500);

    // Verify GET /cost preview includes the draft amounts:
    // Ingredient: 10 * 50 = 500
    // Labour: 2.0 * 150 = 300
    // Packaging: 45
    // Expenses: 35
    // Total: 880 rupees
    const costReview = await request(app)
      .get(`/api/v1/production/batches/${draftBatch._id}/cost`)
      .set(auth("OWNER"));
    assert.equal(costReview.status, 200);
    const cost = costReview.body.data.cost;
    assert.equal(cost.ingredientCost, 500);
    assert.equal(cost.labourCost, 300);
    assert.equal(cost.packagingCost, 45);
    assert.equal(cost.otherExpense, 35);
    assert.equal(cost.totalCost, 880);
    assert.equal(cost.costPerUsableItem, 44);
    assert.equal(cost.status, "READY_TO_FINALIZE");
  });

  // 10. Unauthorized roles cannot edit labour rate snapshots or save draft costs
  await t.test("Unauthorized roles cannot edit labour rate snapshots or save draft costs", async () => {
    // Staff attempts to save draft cost -> 403
    const staffDraft = await request(app)
      .patch(`/api/v1/production/batches/${draftBatchId}/cost/draft`)
      .set({ Authorization: `Bearer ${staff1Token}` })
      .send({ packagingCost: 50 });
    assert.equal(staffDraft.status, 403);

    // Staff attempts to update hourlyRateSnapshot via assignment endpoint -> 403
    const staffRateAttempt = await request(app)
      .patch(`/api/v1/production/batches/${draftBatchId}/assignment`)
      .set({ Authorization: `Bearer ${staff1Token}` })
      .send({ hourlyRateSnapshot: 999 });
    assert.equal(staffRateAttempt.status, 403);

    // Customer attempts to save draft cost -> 403
    const custDraft = await request(app)
      .patch(`/api/v1/production/batches/${draftBatchId}/cost/draft`)
      .set(auth("CUSTOMER"))
      .send({ packagingCost: 50 });
    assert.equal(custDraft.status, 403);
  });

  // 11. Batch update preserves existing worker rate snapshots when worker profile rate changes
  await t.test("Batch update preserves existing worker rate snapshots when worker profile rate changes", async () => {
    // Create planned batch with staff 2 (current rate: 120)
    const pBatch = await request(app)
      .post("/api/v1/production/batches")
      .set(auth("OWNER"))
      .send({
        product: String(product._id),
        productVariant: String(variantId),
        plannedQuantity: 20,
        assignedWorkers: [{ worker: staff2Id, task: "Scaling" }],
      });
    assert.equal(pBatch.status, 201);
    const pBatchId = pBatch.body.data.batch._id;

    // Verify snapshot is 120
    let bDoc = await ProductionBatch.findById(pBatchId);
    assert.equal(bDoc.assignedWorkers[0].hourlyRateSnapshot, 120);

    // Change Sarah's current rate in profile to 200
    await request(app)
      .patch(`/api/v1/workers/${staff2Id}`)
      .set(auth("OWNER"))
      .send({ hourlyLabourRate: 200 });

    // Update planned batch (e.g. notes or re-sending assignedWorkers)
    const updateBatchRes = await request(app)
      .patch(`/api/v1/production/batches/${pBatchId}`)
      .set(auth("OWNER"))
      .send({
        productionNotes: "Updated instructions",
        assignedWorkers: [{ worker: staff2Id, task: "Scaling and Mixing" }],
      });
    assert.equal(updateBatchRes.status, 200);

    // Verify Sarah's snapshot on the batch is STILL 120 (preserved!)
    bDoc = await ProductionBatch.findById(pBatchId);
    assert.equal(bDoc.assignedWorkers[0].hourlyRateSnapshot, 120);
    assert.equal(bDoc.assignedWorkers[0].task, "Scaling and Mixing");
  });
});
