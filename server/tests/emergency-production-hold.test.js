import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import Product from "../src/models/product.model.js";
import Category from "../src/models/category.model.js";
import Recipe from "../src/models/recipe.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import Order from "../src/models/order.model.js";
import User from "../src/models/user.model.js";
import Notification from "../src/models/notification.model.js";
import eventStream from "../src/utils/eventStream.js";
import {
  USER_ROLES,
  PRODUCTION_STATUS as S,
  CUSTOMER_ORDER_STATUSES,
  HOLD_REASONS,
  HOLD_INSTRUCTIONS,
  HOLD_RESOLUTIONS,
  NOTIFICATION_TYPES,
} from "../src/utils/constants.js";
import { generateAccessToken } from "../src/utils/token.utils.js";

test("Emergency Production Hold Test Suite", async (t) => {
  const runSubtest = async (name, fn) => {
    await t.test(name, async (st) => {
      try {
        await fn(st);
      } catch (err) {
        console.error(`\n================== SUBTEST FAILED: ${name} ==================`);
        console.error(err);
        console.error("============================================================\n");
        throw err;
      }
    });
  };

  let suffix;
  let owner;
  let baker;
  let unassignedBaker;
  let customer;
  let ownerAuth;
  let bakerAuth;
  let unassignedAuth;
  let customerAuth;
  let category;
  let flour;
  let variantId;
  let product;
  let recipe;
  let sharedBatch;
  let testOrder1;
  let testOrder2;

  try {
    await connectToDb();

    suffix = `eph_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // 1. Setup Users
    owner = await User.create({
      name: `Owner Hold ${suffix}`,
      email: `owner_${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.OWNER,
      isActive: true,
    });

    baker = await User.create({
      name: `Baker Hold ${suffix}`,
      email: `baker_${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.PRODUCTION_STAFF,
      isActive: true,
    });

    unassignedBaker = await User.create({
      name: `Other Baker ${suffix}`,
      email: `other_${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.PRODUCTION_STAFF,
      isActive: true,
    });

    customer = await User.create({
      name: `Customer Hold ${suffix}`,
      email: `cust_${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.CUSTOMER,
      isActive: true,
    });

    ownerAuth = { Authorization: `Bearer ${generateAccessToken(owner)}` };
    bakerAuth = { Authorization: `Bearer ${generateAccessToken(baker)}` };
    unassignedAuth = { Authorization: `Bearer ${generateAccessToken(unassignedBaker)}` };
    customerAuth = { Authorization: `Bearer ${generateAccessToken(customer)}` };

    // 2. Setup Category, Ingredient, Lot, Product & Recipe
    category = await Category.create({
      name: `Pastries ${suffix}`,
      slug: `pastries-${suffix}`,
      isActive: true,
    });

    flour = await Ingredient.create({
      name: `Pastry Flour ${suffix}`,
      slug: `pastry-flour-${suffix}`,
      unit: "kg",
      currentStock: 100,
      reservedStock: 0,
      minThreshold: 5,
      costPerUnit: 40,
      shelfLifeDays: 90,
    });

    await InventoryLot.create({
      ingredient: flour._id,
      lotNumber: `LOT-FLOUR-${suffix}`,
      originalQuantity: 100,
      remainingQuantity: 100,
      unit: "kg",
      unitCost: 40,
      purchaseDate: new Date(),
      expiryDate: new Date(Date.now() + 60 * 86400000),
      status: "AVAILABLE",
    });

    variantId = new mongoose.Types.ObjectId();
    product = await Product.create({
      name: `Croissant Batch ${suffix}`,
      slug: `croissant-batch-${suffix}`,
      category: category._id,
      description: "Flaky butter croissants",
      basePrice: 50,
      preparationTime: 20,
      productionTime: 25,
      unit: "piece",
      variants: [
        {
          _id: variantId,
          name: "Standard Pack (4 pcs)",
          quantity: 4,
          unit: "piece",
          price: 200,
          isActive: true,
        },
      ],
      isActive: true,
    });

    recipe = await Recipe.create({
      product: product._id,
      variant: variantId,
      revision: 1,
      expectedYield: 4,
      yieldUnit: "piece",
      preparationTime: 20,
      productionTime: 25,
      ingredients: [
        {
          ingredient: flour._id,
          quantity: 0.5,
          unit: "kg",
        },
      ],
      instructions: "Mix dough, roll croissants, and bake at 200C",
      isActive: true,
    });
  } catch (setupErr) {
    console.error("SETUP ERROR IN TEST SUITE:", setupErr);
    throw setupErr;
  }

  // Cleanup helper
  t.after(async () => {
    try {
      if (owner) await User.deleteMany({ _id: { $in: [owner._id, baker._id, unassignedBaker._id, customer._id] } });
      if (category) await Category.deleteOne({ _id: category._id });
      if (product) await Product.deleteOne({ _id: product._id });
      if (recipe) await Recipe.deleteOne({ _id: recipe._id });
      if (flour) await Ingredient.deleteOne({ _id: flour._id });
      if (flour) await InventoryLot.deleteMany({ ingredient: flour._id });
      if (suffix) await ProductionBatch.deleteMany({ batchNumber: new RegExp(suffix) });
      if (testOrder1) await Order.deleteOne({ _id: testOrder1._id });
      if (testOrder2) await Order.deleteOne({ _id: testOrder2._id });
      if (owner) await Notification.deleteMany({ recipient: { $in: [owner._id, baker._id, customer._id] } });
    } finally {
      eventStream.closeAll();
      await disconnectDb();
    }
  });

  await runSubtest("1. Create Orders & Production Batch assigned to Baker", async () => {
    testOrder1 = await Order.create({
      orderNumber: `ORD-HOLD-1-${suffix}`,
      customer: customer._id,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Standard Pack (4 pcs)",
          quantity: 1,
          unitPrice: 200,
          lineTotal: 200,
          specialInstructions: "Extra crispy, please deliver fresh",
        },
      ],
      subtotal: 200,
      total: 200,
      orderType: "DELIVERY",
      deliveryDate: "2026-11-01",
      deliveryTimeSlot: "10:00-12:00",
      contactName: "Customer Hold 1",
      contactPhone: "9876543210",
      status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
      paymentStatus: "PAYMENT_CONFIRMED",
    });

    testOrder2 = await Order.create({
      orderNumber: `ORD-HOLD-2-${suffix}`,
      customer: customer._id,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Standard Pack (4 pcs)",
          quantity: 1,
          unitPrice: 200,
          lineTotal: 200,
          specialInstructions: "Light golden bake",
        },
      ],
      subtotal: 200,
      total: 200,
      orderType: "PICKUP",
      deliveryDate: "2026-11-01",
      deliveryTimeSlot: "12:00-14:00",
      contactName: "Customer Hold 2",
      contactPhone: "9876543210",
      status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
      paymentStatus: "PAYMENT_CONFIRMED",
    });

    // Create shared batch for both orders
    sharedBatch = await ProductionBatch.create({
      batchNumber: `BATCH-${suffix}`,
      product: product._id,
      productVariant: variantId,
      productSnapshot: {
        productName: product.name,
        variantName: "Standard Pack (4 pcs)",
        variantQuantity: 4,
        variantUnit: "piece",
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 4,
        yieldUnit: "piece",
        recipeBatchQuantity: 2,
        ingredients: [{ ingredient: flour._id, name: flour.name, quantity: 1, unit: "kg" }],
      },
      plannedQuantity: 8,
      unit: "piece",
      status: S.PLANNED,
      relatedOrders: [testOrder1._id, testOrder2._id],
      assignedWorkers: [{ worker: baker._id, task: "Bake Croissants" }],
      createdBy: owner._id,
    });

    assert.ok(sharedBatch._id);
    assert.equal(sharedBatch.status, S.PLANNED);
  });

  await runSubtest("2. Baker accepts and verifies batch, transitions to IN_PRODUCTION", async () => {
    // Stage 1: Accept
    const acceptRes = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/accept`)
      .set(bakerAuth)
      .send({
        batchNumber: sharedBatch.batchNumber,
        product: product._id.toString(),
        plannedQuantity: 8,
        relatedOrders: [testOrder1._id.toString(), testOrder2._id.toString()],
        assignedWorkers: [baker._id.toString()],
      });
    assert.equal(acceptRes.status, 200);

    // Stage 2: Verify
    const verifyRes = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/verify`)
      .set(bakerAuth)
      .send({
        batchNumber: sharedBatch.batchNumber,
        product: product._id.toString(),
        plannedQuantity: 8,
        relatedOrders: [testOrder1._id.toString(), testOrder2._id.toString()],
        assignedWorkers: [baker._id.toString()],
      });
    assert.equal(verifyRes.status, 200);

    // Stage 3: Start Baking -> IN_PRODUCTION
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/start`)
      .set(bakerAuth)
      .send({ autoConsume: true });
    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.data.batch.status, S.IN_PRODUCTION);

    // Update order status to IN_PRODUCTION
    await Order.updateMany(
      { _id: { $in: [testOrder1._id, testOrder2._id] } },
      { $set: { status: CUSTOMER_ORDER_STATUSES.IN_PRODUCTION } }
    );
  });

  await runSubtest("3. Unauthorized user cannot place hold (403 Forbidden)", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/hold`)
      .set(bakerAuth)
      .send({
        reason: HOLD_REASONS.CUSTOMER_CANCELLED,
        instruction: HOLD_INSTRUCTIONS.STOP_IMMEDIATELY,
        ownerNote: "Baker cannot place hold on behalf of owner",
      });
    assert.equal(res.status, 403);
  });

  await runSubtest("4. Owner places in-production batch on hold (STOP_IMMEDIATELY)", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/hold`)
      .set(ownerAuth)
      .send({
        reason: HOLD_REASONS.CUSTOMER_CANCELLED,
        instruction: HOLD_INSTRUCTIONS.STOP_IMMEDIATELY,
        ownerNote: "Customer called to cancel ORD-HOLD-1. Please stop immediately.",
      });

    assert.equal(res.status, 200);
    const holdState = res.body.data.batch.holdState;
    assert.equal(holdState.isOnHold, true);
    assert.equal(holdState.holdReason, HOLD_REASONS.CUSTOMER_CANCELLED);
    assert.equal(holdState.holdInstruction, HOLD_INSTRUCTIONS.STOP_IMMEDIATELY);
    assert.equal(holdState.instructionVersion, 1);
    assert.equal(holdState.bakerAcknowledged, false);

    // Verify related orders were synced
    const order1 = await Order.findById(testOrder1._id);
    assert.equal(order1.holdState.isOnHold, true);
    assert.equal(order1.holdState.holdReason, HOLD_REASONS.CUSTOMER_CANCELLED);

    // Verify baker received notification
    const notif = await Notification.findOne({
      recipient: baker._id,
      type: NOTIFICATION_TYPES.PRODUCTION_HOLD,
    });
    assert.ok(notif, "Baker should receive PRODUCTION_HOLD notification");
    assert.match(notif.message, /EMERGENCY HOLD/);
  });

  await runSubtest("5. Backend blocks production transitions while STOP_IMMEDIATELY is active (409 Conflict)", async () => {
    // Attempting to complete (record output) must be rejected with 409 Conflict
    const completeRes = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/complete`)
      .set(bakerAuth)
      .send({
        outputQuantity: 8,
        outputUnit: "piece",
        outputRemark: "Finished early",
      });

    assert.equal(completeRes.status, 409);
    assert.match(completeRes.body.message, /EMERGENCY HOLD/);

    // Attempting to package must also be rejected
    const packageRes = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/package`)
      .set(bakerAuth)
      .send({
        packagedQuantity: 8,
      });
    assert.equal(packageRes.status, 409);
  });

  await runSubtest("6. Baker acknowledges hold and reports state & consumed ingredients", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/acknowledge-hold`)
      .set(bakerAuth)
      .send({
        currentStage: "Stage 4: Baking in oven",
        workCompleted: "Dough kneaded and proofed, baked for 12 minutes in deck oven",
        ingredientsConsumed: true,
        safeStoppingPointReached: false,
        note: "Taking croissants out now to prevent burning, but stopping further work",
      });

    assert.equal(res.status, 200);
    const holdState = res.body.data.batch.holdState;
    assert.equal(holdState.bakerAcknowledged, true);
    assert.equal(holdState.bakerResponse.ingredientsConsumed, true);
    assert.equal(holdState.bakerResponse.currentStage, "Stage 4: Baking in oven");

    // Verify manager received acknowledgement notification
    const mgrNotif = await Notification.findOne({
      recipient: owner._id,
      type: NOTIFICATION_TYPES.PRODUCTION_HOLD_ACKNOWLEDGED,
    });
    assert.ok(mgrNotif);
    assert.match(mgrNotif.message, /acknowledged hold/);
  });

  await runSubtest("7. Owner updates instruction to CONTINUE_CURRENT_STEP -> increments version and resets ack", async () => {
    const res = await request(app)
      .patch(`/api/v1/production/batches/${sharedBatch._id}/hold`)
      .set(ownerAuth)
      .send({
        instruction: HOLD_INSTRUCTIONS.CONTINUE_CURRENT_STEP,
        ownerNote: "Finish baking current tray so ingredients aren't wasted, but do not package.",
      });

    assert.equal(res.status, 200);
    const holdState = res.body.data.batch.holdState;
    assert.equal(holdState.holdInstruction, HOLD_INSTRUCTIONS.CONTINUE_CURRENT_STEP);
    assert.equal(holdState.instructionVersion, 2);
    assert.equal(holdState.bakerAcknowledged, false, "Acknowledgement should reset on new instruction");
    assert.equal(holdState.permittedStep, "RECORD_OUTPUT");

    // Verify baker received update notification
    const updateNotif = await Notification.findOne({
      recipient: baker._id,
      type: NOTIFICATION_TYPES.PRODUCTION_HOLD_UPDATED,
    });
    assert.ok(updateNotif);
    assert.match(updateNotif.title, /HOLD INSTRUCTION UPDATED/);
  });

  await runSubtest("8. CONTINUE_CURRENT_STEP allows recording output but blocks packaging", async () => {
    // Record output is permitted
    const completeRes = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/complete`)
      .set(bakerAuth)
      .send({
        outputQuantity: 8,
        outputUnit: "piece",
        outputRemark: "Completed bake under hold permission",
      });

    assert.equal(completeRes.status, 200);

    // Packaging is NOT permitted and must be blocked
    const pkgRes = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/package`)
      .set(bakerAuth)
      .send({
        packagedQuantity: 8,
      });

    assert.equal(pkgRes.status, 409);
    assert.match(pkgRes.body.message, /blocked until hold is resolved/);
  });

  await runSubtest("9. Shared Batch: Cancel Order 1 while keeping Order 2 active", async () => {
    // Initial flour check: consumed in production
    const batchBefore = await ProductionBatch.findById(sharedBatch._id);
    assert.equal(batchBefore.consumptionStatus, "CONSUMED");

    // Owner resolves hold by cancelling Order 1
    const res = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/resolve-hold`)
      .set(ownerAuth)
      .send({
        resolution: HOLD_RESOLUTIONS.CANCEL_ORDER,
        resolutionNote: "Customer 1 cancelled; Customer 2 still wants their croissants",
        cancelOrderId: testOrder1._id.toString(),
      });

    assert.equal(res.status, 200);

    // Verify Order 1 is CANCELLED
    const cancelledOrder1 = await Order.findById(testOrder1._id);
    assert.equal(cancelledOrder1.status, CUSTOMER_ORDER_STATUSES.CANCELLED);
    assert.equal(cancelledOrder1.holdState.isOnHold, false);
    assert.equal(cancelledOrder1.holdState.holdResolution, "CANCEL_ORDER");

    // Verify Order 2 is STILL IN_PRODUCTION (not cancelled!)
    const activeOrder2 = await Order.findById(testOrder2._id);
    assert.equal(activeOrder2.status, CUSTOMER_ORDER_STATUSES.IN_PRODUCTION);

    // Verify batch is STILL active because Order 2 remains
    const batchAfter = await ProductionBatch.findById(sharedBatch._id);
    assert.notEqual(batchAfter.status, S.CANCELLED);
    assert.equal(batchAfter.holdState.isOnHold, false);

    // Verify consumed ingredients were NOT refunded to raw inventory
    assert.equal(batchAfter.consumptionStatus, "CONSUMED");
  });

  await runSubtest("10. Cancelled Order 1 cannot be transitioned or resumed", async () => {
    const res = await request(app)
      .patch(`/api/v1/orders/${testOrder1._id}/status`)
      .set(ownerAuth)
      .send({ status: CUSTOMER_ORDER_STATUSES.CONFIRMED });

    assert.equal(res.status, 409);
  });

  await runSubtest("11. Production resumes for Order 2: Package and Finalize without duplication", async () => {
    // Packaging is now unblocked
    const pkgRes = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/package`)
      .set(bakerAuth)
      .send({
        packages: [
          {
            packageNumber: 1,
            quantity: 4,
            unit: "piece",
            remark: "Pack for Order 2",
            orderId: testOrder2._id.toString(),
            orderNumber: testOrder2.orderNumber,
          },
        ],
        packagingRemark: "Packaged cleanly for Order 2",
      });

    assert.equal(pkgRes.status, 200);

    // Finalize
    const finalizeRes = await request(app)
      .post(`/api/v1/production/batches/${sharedBatch._id}/finalize`)
      .set(bakerAuth)
      .send();

    assert.equal(finalizeRes.status, 200);
    assert.equal(finalizeRes.body.data.batch.status, S.COMPLETED);
  });

  await runSubtest("12. Direct Order Hold and Resolve with RESUME", async () => {
    // Create new order
    const order3 = await Order.create({
      orderNumber: `ORD-HOLD-3-${suffix}`,
      customer: customer._id,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Standard Pack (4 pcs)",
          quantity: 1,
          unitPrice: 200,
          lineTotal: 200,
        },
      ],
      subtotal: 200,
      total: 200,
      orderType: "PICKUP",
      deliveryDate: "2026-11-01",
      deliveryTimeSlot: "14:00-16:00",
      contactName: "Customer Hold 3",
      contactPhone: "9876543210",
      status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
      paymentStatus: "PAYMENT_CONFIRMED",
    });

    // Place order on hold via order hold endpoint
    const holdRes = await request(app)
      .post(`/api/v1/orders/${order3._id}/hold`)
      .set(ownerAuth)
      .send({
        reason: HOLD_REASONS.EQUIPMENT_ISSUE,
        instruction: HOLD_INSTRUCTIONS.STOP_IMMEDIATELY,
        ownerNote: "Oven 2 heating element check in progress",
      });

    assert.equal(holdRes.status, 200);
    const updatedOrder = await Order.findById(order3._id);
    assert.equal(updatedOrder.holdState.isOnHold, true);
    assert.equal(updatedOrder.holdState.holdReason, HOLD_REASONS.EQUIPMENT_ISSUE);

    // Cancel from hold endpoint
    const cancelRes = await request(app)
      .post(`/api/v1/orders/${order3._id}/cancel-hold`)
      .set(ownerAuth)
      .send({ reason: "Oven maintenance requires rescheduling" });

    assert.equal(cancelRes.status, 200);
    const finalOrder = await Order.findById(order3._id);
    assert.equal(finalOrder.status, CUSTOMER_ORDER_STATUSES.CANCELLED);
    assert.equal(finalOrder.holdState.isOnHold, false);

    await Order.deleteOne({ _id: order3._id });
  });
});
