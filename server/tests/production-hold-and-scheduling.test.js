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

test("Production Hold and Batch Scheduling Regression Test Suite", async (t) => {
  let suffix;
  let owner;
  let baker;
  let customer;
  let ownerAuth;
  let bakerAuth;
  let customerAuth;
  let category;
  let flour;
  let product;
  let variantId;
  let recipe;
  let activeOrder;
  let heldOrder;
  let cancelledOrder;
  let inProdBatch;

  try {
    await connectToDb();
    suffix = `phs_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // 1. Users
    owner = await User.create({
      name: `Owner PHS ${suffix}`,
      email: `owner_${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.OWNER,
      isActive: true,
    });

    baker = await User.create({
      name: `Baker PHS ${suffix}`,
      email: `baker_${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.PRODUCTION_STAFF,
      isActive: true,
    });

    customer = await User.create({
      name: `Customer PHS ${suffix}`,
      email: `cust_${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.CUSTOMER,
      isActive: true,
    });

    ownerAuth = { Authorization: `Bearer ${generateAccessToken(owner)}` };
    bakerAuth = { Authorization: `Bearer ${generateAccessToken(baker)}` };
    customerAuth = { Authorization: `Bearer ${generateAccessToken(customer)}` };

    // 2. Catalog: Category, Ingredient, Product with Variant & Recipe
    category = await Category.create({
      name: `Category PHS ${suffix}`,
      slug: `cat-phs-${suffix}`,
      description: "Testing hold and scheduling",
      isActive: true,
    });

    flour = await Ingredient.create({
      name: `Flour PHS ${suffix}`,
      slug: `flour-phs-${suffix}`,
      unit: "kg",
      currentStock: 100,
      minThreshold: 10,
      costPerUnit: 40,
      shelfLifeDays: 90,
      isActive: true,
    });

    await InventoryLot.create({
      ingredient: flour._id,
      lotNumber: `LOT-PHS-${suffix}`,
      originalQuantity: 100,
      remainingQuantity: 100,
      unit: "kg",
      unitCost: 40,
      purchaseDate: new Date(),
      expiryDate: new Date(Date.now() + 30 * 86400000),
      status: "AVAILABLE",
    });

    variantId = new mongoose.Types.ObjectId();
    product = await Product.create({
      name: `Sourdough Loaf ${suffix}`,
      slug: `sourdough-loaf-${suffix}`,
      category: category._id,
      description: "Artisan loaf",
      basePrice: 180,
      preparationTime: 20,
      productionTime: 40,
      unit: "piece",
      isActive: true,
      isAvailable: true,
      variants: [
        {
          _id: variantId,
          name: "Standard 500g",
          price: 180,
          weight: 500,
          quantity: 1,
          unit: "piece",
          isActive: true,
          isAvailable: true,
        },
      ],
    });

    recipe = await Recipe.create({
      product: product._id,
      variant: variantId,
      revision: 1,
      preparationTime: 20,
      productionTime: 40,
      expectedYield: 6,
      yieldUnit: "piece",
      ingredients: [
        {
          ingredient: flour._id,
          quantity: 2,
          unit: "kg",
        },
      ],
      isActive: true,
    });

    // 3. Orders: Active Confirmed Order, Held Order, Cancelled Order
    activeOrder = await Order.create({
      orderNumber: `ORD-ACT-${suffix}`,
      customer: customer._id,
      contactName: "Alice Active",
      contactPhone: "9876543210",
      orderType: "PICKUP",
      deliveryDate: "2026-11-01",
      deliveryTimeSlot: "10:00-12:00",
      paymentMethod: "COD",
      paymentStatus: "PAYMENT_CONFIRMED",
      status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
      subtotal: 360,
      total: 360,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Standard 500g",
          quantity: 2,
          unitPrice: 180,
          lineTotal: 360,
        },
      ],
    });

    heldOrder = await Order.create({
      orderNumber: `ORD-HELD-${suffix}`,
      customer: customer._id,
      contactName: "Bob Held",
      contactPhone: "9876543211",
      orderType: "PICKUP",
      deliveryDate: "2026-11-01",
      deliveryTimeSlot: "10:00-12:00",
      paymentMethod: "COD",
      paymentStatus: "PAYMENT_CONFIRMED",
      status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
      subtotal: 360,
      total: 360,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Standard 500g",
          quantity: 2,
          unitPrice: 180,
          lineTotal: 360,
        },
      ],
      holdState: {
        isOnHold: true,
        holdReason: HOLD_REASONS[0],
        holdInstruction: HOLD_INSTRUCTIONS[0],
        ownerNote: "Customer requested cancellation review",
        holdRequestedAt: new Date(),
        holdRequestedBy: owner._id,
        instructionVersion: 1,
      },
    });

    cancelledOrder = await Order.create({
      orderNumber: `ORD-CANC-${suffix}`,
      customer: customer._id,
      contactName: "Charlie Cancelled",
      contactPhone: "9876543212",
      orderType: "PICKUP",
      deliveryDate: "2026-11-01",
      deliveryTimeSlot: "10:00-12:00",
      paymentMethod: "COD",
      paymentStatus: "PAYMENT_CONFIRMED",
      status: CUSTOMER_ORDER_STATUSES.CANCELLED,
      subtotal: 360,
      total: 360,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Standard 500g",
          quantity: 2,
          unitPrice: 180,
          lineTotal: 360,
        },
      ],
    });

    // 4. Batch for Hold testing
    inProdBatch = await ProductionBatch.create({
      batchNumber: `BATCH-HOLD-${suffix}`,
      product: product._id,
      productVariant: variantId,
      productSnapshot: {
        productName: product.name,
        variantName: "Standard 500g",
        variantQuantity: 1,
        variantUnit: "piece",
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 6,
        yieldUnit: "piece",
        recipeBatchQuantity: 1,
        ingredients: [{ ingredient: flour._id, name: flour.name, quantity: 2, unit: "kg" }],
      },
      plannedQuantity: 6,
      unit: "piece",
      status: S.PLANNED,
      relatedOrders: [activeOrder._id],
      assignedWorkers: [{ worker: baker._id, task: "Lead Baker" }],
      createdBy: owner._id,
    });

    // Advance batch to IN_PRODUCTION: accept -> verify -> start
    await request(app)
      .post(`/api/v1/production/batches/${inProdBatch._id}/accept`)
      .set(bakerAuth)
      .send({
        batchNumber: inProdBatch.batchNumber,
        product: product._id.toString(),
        plannedQuantity: 6,
      });

    await request(app)
      .post(`/api/v1/production/batches/${inProdBatch._id}/verify`)
      .set(bakerAuth)
      .send({
        verifiedIngredients: [{ ingredient: flour._id.toString(), verified: true }],
        verifiedEquipment: [{ equipmentName: "Deck Oven", verified: true }],
      });

    await request(app)
      .post(`/api/v1/production/batches/${inProdBatch._id}/start`)
      .set(bakerAuth);
  } catch (err) {
    console.error("Test setup failed:", err);
    throw err;
  }

  // ==================== TEST SUITE: HOLD FUNCTIONALITY ====================
  await t.test("1. Owner places in-production batch on hold successfully", async () => {
    const res = await request(app)
      .post(`/api/v1/production/batches/${inProdBatch._id}/hold`)
      .set(ownerAuth)
      .send({
        reason: HOLD_REASONS.CUSTOMER_CANCELLED,
        instruction: HOLD_INSTRUCTIONS.STOP_IMMEDIATELY,
        ownerNote: "Urgent hold on dough mixing",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.batch.holdState.isOnHold, true);
    assert.equal(res.body.data.batch.holdState.holdReason, HOLD_REASONS.CUSTOMER_CANCELLED);
    assert.equal(res.body.data.batch.holdState.instructionVersion, 1);
  });

  await t.test("2. Hold persists in database and is returned on batch inspection", async () => {
    const res = await request(app)
      .get(`/api/v1/production/batches/${inProdBatch._id}`)
      .set(ownerAuth);

    assert.equal(res.status, 200);
    const b = res.body.data.batch;
    assert.equal(b.holdState.isOnHold, true);
    assert.equal(b.holdState.holdReason, HOLD_REASONS.CUSTOMER_CANCELLED);
    assert.equal(b.holdState.holdInstruction, HOLD_INSTRUCTIONS.STOP_IMMEDIATELY);
  });

  await t.test("3. Assigned baker receives hold notification in notification stream", async () => {
    const notifs = await Notification.find({
      recipient: baker._id,
      type: NOTIFICATION_TYPES.PRODUCTION_HOLD,
    });
    assert.ok(notifs.length >= 1, "Baker should receive hold notification");
    const holdNotif = notifs[0];
    assert.equal(holdNotif.relatedEntityType, "PRODUCTION_BATCH");
    assert.equal(String(holdNotif.relatedEntityId), String(inProdBatch._id));
  });

  await t.test("4. Invalid or non-existent batch ID returns 404 or 400", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res404 = await request(app)
      .post(`/api/v1/production/batches/${fakeId}/hold`)
      .set(ownerAuth)
      .send({
        reason: HOLD_REASONS.CUSTOMER_CANCELLED,
        instruction: HOLD_INSTRUCTIONS.STOP_IMMEDIATELY,
      });
    assert.equal(res404.status, 404);

    const res400 = await request(app)
      .post(`/api/v1/production/batches/invalid-hex-id/hold`)
      .set(ownerAuth)
      .send({
        reason: HOLD_REASONS.CUSTOMER_CANCELLED,
        instruction: HOLD_INSTRUCTIONS.STOP_IMMEDIATELY,
      });
    assert.equal(res400.status, 400);
  });

  await t.test("5. Unauthorized user (customer or unauthenticated) cannot place hold (403/401)", async () => {
    const resCust = await request(app)
      .post(`/api/v1/production/batches/${inProdBatch._id}/hold`)
      .set(customerAuth)
      .send({
        reason: HOLD_REASONS.CUSTOMER_CANCELLED,
        instruction: HOLD_INSTRUCTIONS.STOP_IMMEDIATELY,
      });
    assert.equal(resCust.status, 403);

    const resNoAuth = await request(app)
      .post(`/api/v1/production/batches/${inProdBatch._id}/hold`)
      .send({
        reason: HOLD_REASONS.CUSTOMER_CANCELLED,
        instruction: HOLD_INSTRUCTIONS.STOP_IMMEDIATELY,
      });
    assert.equal(resNoAuth.status, 401);
  });

  await t.test("6. Production transitions blocked by backend while STOP_IMMEDIATELY is active (409)", async () => {
    const resComp = await request(app)
      .post(`/api/v1/production/batches/${inProdBatch._id}/complete`)
      .set(bakerAuth)
      .send({ outputQuantity: 6 });
    assert.equal(resComp.status, 409);

    const resPkg = await request(app)
      .post(`/api/v1/production/batches/${inProdBatch._id}/package`)
      .set(bakerAuth)
      .send({ packages: [{ quantity: 6, unit: "piece" }] });
    assert.equal(resPkg.status, 409);
  });

  // ==================== TEST SUITE: SCHEDULING FUNCTIONALITY ====================
  await t.test("7. Owner schedules a valid production batch successfully (multiple of yield)", async () => {
    const res = await request(app)
      .post("/api/v1/production/batches")
      .set(ownerAuth)
      .send({
        product: product._id,
        productVariant: variantId,
        plannedQuantity: 12, // Recipe expectedYield is 6; 12 is a whole multiple (2 batches)
        plannedStartTime: new Date().toISOString(),
        assignedWorkers: [{ worker: baker._id, task: "Oven Lead" }],
        productionNotes: "Schedule test batch notes",
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    const created = res.body.data.batch;
    assert.equal(created.status, S.PLANNED);
    assert.equal(created.plannedQuantity, 12);
    assert.equal(created.recipeSnapshot.recipeBatchQuantity, 2);
    assert.equal(created.assignedWorkers.length, 1);
  });

  await t.test("8. Scheduling rejects plannedQuantity that is zero or negative (400)", async () => {
    const res = await request(app)
      .post("/api/v1/production/batches")
      .set(ownerAuth)
      .send({
        product: product._id,
        productVariant: variantId,
        plannedQuantity: -1,
        assignedWorkers: [{ worker: baker._id, task: "Oven Lead" }],
      });

    assert.equal(res.status, 400);
  });

  await t.test("9. Scheduling rejects request missing product or variant (400)", async () => {
    const res = await request(app)
      .post("/api/v1/production/batches")
      .set(ownerAuth)
      .send({
        product: product._id,
        // productVariant is missing
        plannedQuantity: 6,
      });

    assert.equal(res.status, 400);
  });

  await t.test("10. Scheduling batch rejects linked order that is ON EMERGENCY HOLD (400)", async () => {
    const res = await request(app)
      .post("/api/v1/production/batches")
      .set(ownerAuth)
      .send({
        product: product._id,
        productVariant: variantId,
        plannedQuantity: 6,
        relatedOrders: [heldOrder._id],
        assignedWorkers: [{ worker: baker._id, task: "Lead" }],
      });

    assert.equal(res.status, 400);
    assert.ok(
      res.body.message?.includes("emergency hold"),
      `Expected emergency hold message but got: ${res.body.message}`
    );
  });

  await t.test("11. Assigning production (POST /api/v1/orders/:id/assign) rejects order on hold (409)", async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${heldOrder._id}/assign`)
      .set(ownerAuth)
      .send({
        workers: [baker._id],
        task: "Bake sourdough",
      });

    assert.equal(res.status, 409);
    assert.ok(
      res.body.message?.includes("emergency hold"),
      `Expected emergency hold conflict message but got: ${res.body.message}`
    );
  });

  await t.test("12. Scheduling batch rejects linked order that is CANCELLED (400)", async () => {
    const res = await request(app)
      .post("/api/v1/production/batches")
      .set(ownerAuth)
      .send({
        product: product._id,
        productVariant: variantId,
        plannedQuantity: 6,
        relatedOrders: [cancelledOrder._id],
        assignedWorkers: [{ worker: baker._id, task: "Lead" }],
      });

    assert.equal(res.status, 400);
    assert.ok(
      res.body.message?.includes("cancelled"),
      `Expected cancellation message but got: ${res.body.message}`
    );
  });

  // Clean up
  t.after(async () => {
    try {
      if (suffix) {
        await ProductionBatch.deleteMany({ batchNumber: new RegExp(suffix) });
        await Order.deleteMany({ orderNumber: new RegExp(suffix) });
        await Recipe.deleteMany({ product: product?._id });
        await Product.deleteMany({ _id: product?._id });
        await Category.deleteMany({ _id: category?._id });
        await InventoryLot.deleteMany({ lotNumber: new RegExp(suffix) });
        await Ingredient.deleteMany({ _id: flour?._id });
        await Notification.deleteMany({ recipient: { $in: [owner?._id, baker?._id, customer?._id] } });
        await User.deleteMany({ _id: { $in: [owner?._id, baker?._id, customer?._id] } });
      }
      await disconnectDb();
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr.message);
    }
  });
});
