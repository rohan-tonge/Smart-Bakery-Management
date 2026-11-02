process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import Cart from "../src/models/cart.model.js";
import Order from "../src/models/order.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import InventoryTransaction from "../src/models/inventoryTransaction.model.js";
import Recipe from "../src/models/recipe.model.js";
import Setting from "../src/models/setting.model.js";
import ProductionBatch from "../src/models/productionBatch.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";
import { getBakeryTomorrowString } from "../src/utils/date.utils.js";

test("Planned Production, Finished-Goods Stock & Customer Order Fulfillment", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tomorrowStr = getBakeryTomorrowString();

  // Create test actors
  const users = {};
  for (const role of [USER_ROLES.CUSTOMER, USER_ROLES.OWNER, USER_ROLES.PRODUCTION_STAFF]) {
    const user = await User.create({
      name: `Planned Prod ${role}`,
      email: `${role.toLowerCase()}-${suffix}@planned-test.com`,
      password: "Password123!",
      role,
      isActive: true,
    });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });

  let category;
  let product;
  let ingredient;
  let recipe;
  let plannedBatch;

  // Cleanup on completion
  t.after(async () => {
    const customerId = users[USER_ROLES.CUSTOMER].user._id;
    await Order.deleteMany({ customer: customerId });
    await Cart.deleteMany({ customer: customerId });
    await ProductionBatch.deleteMany({
      $or: [
        { product: product?._id },
        { createdBy: users[USER_ROLES.OWNER].user._id },
      ],
    });
    if (recipe) await Recipe.deleteOne({ _id: recipe._id });
    if (ingredient) {
      await InventoryTransaction.deleteMany({ ingredient: ingredient._id });
      await InventoryLot.deleteMany({ ingredient: ingredient._id });
      await Ingredient.deleteOne({ _id: ingredient._id });
    }
    if (product) {
      await FinishedProductStock.deleteMany({ product: product._id });
      await Product.deleteOne({ _id: product._id });
    }
    if (category) await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@planned-test\\.com$`) });
    await disconnectDb();
  });

  // 1. Setup Base Data: Category, Product (Butter Cookies, kg), Ingredient (Butter, Flour), and Recipe
  category = await Category.create({ name: `Bakery Sweets ${suffix}`, slug: `bakery-sweets-${suffix}` });

  ingredient = await Ingredient.create({
    name: `Premium Butter ${suffix}`,
    slug: `premium-butter-${suffix}`,
    unit: "kg",
    costPerUnit: 250,
    currentStock: 100,
    reservedStock: 0,
    minStockThreshold: 5,
  });

  await InventoryLot.create({
    ingredient: ingredient._id,
    lotNumber: `LOT-BUTTER-${suffix}`,
    originalQuantity: 100,
    remainingQuantity: 100,
    unit: "kg",
    unitCost: 250,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  product = await Product.create({
    name: `Butter Cookies ${suffix}`,
    slug: `butter-cookies-${suffix}`,
    category: category._id,
    basePrice: 400,
    unit: "kg",
    isActive: true,
    isAvailable: true,
    allowCustomization: false,
    leadTimeHours: 2,
    variants: [{ name: "Standard Pack", price: 400, quantity: 1, unit: "kg", isActive: true }],
  });

  const variantId = product.variants[0]._id;

  // Configure production capacity with clean day reservations
  await Setting.findOneAndUpdate(
    { key: "PRODUCTION_CAPACITY" },
    {
      $set: {
        value: {
          workingHours: { open: "08:00", close: "22:00" },
          slotMinutes: 90,
          minutesPerStaffPerDay: 480,
          ovens: [{ name: "Test Oven 1", minutesPerDay: 720 }],
          reservedByDay: {},
        },
        description: "Owner-configured production capacity",
      },
    },
    { upsert: true }
  );

  recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    name: `Butter Cookies Standard Recipe ${suffix}`,
    ingredients: [{ ingredient: ingredient._id, quantity: 0.5, unit: "kg" }],
    preparationTime: 20,
    productionTime: 40,
    expectedYield: 1, // 1 kg output per batch step
    yieldUnit: "kg",
    isActive: true,
  });

  // Ensure initial finished product stock entry exists with 0 on hand
  let finishedStock = await FinishedProductStock.create({
    product: product._id,
    variant: variantId,
    onHandQuantity: 0,
    reservedQuantity: 0,
    reorderPoint: 5,
    unit: "kg",
    updatedBy: users[USER_ROLES.OWNER].user._id,
  });
  assert.equal(finishedStock.onHandQuantity, 0);

  // =========================================================================
  // TEST 1: Owner Proactively Schedules Planned Production (Festival Demand - Diwali)
  // =========================================================================
  await t.test("1. Owner schedules 20 kg planned production without customer order", async () => {
    const res = await request(app)
      .post("/api/v1/production/batches")
      .set(auth(USER_ROLES.OWNER))
      .send({
        product: product._id.toString(),
        productVariant: variantId.toString(),
        plannedQuantity: 20,
        batchType: "PLANNED_PRODUCTION",
        plannedReason: "Festival Demand - Diwali",
        priority: "HIGH",
        productionDate: tomorrowStr,
        timeSlot: "09:00 - 12:00",
        productionNotes: "Prepare Diwali special gift boxes",
        assignedWorkers: [{ worker: users[USER_ROLES.PRODUCTION_STAFF].user._id.toString(), task: "Knead and Bake" }],
      });

    console.log("TEST 1 RES BODY:", JSON.stringify(res.body));
    assert.equal(res.status, 201, `Failed to create planned batch: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.data.batch, "Batch should be returned");
    plannedBatch = res.body.data.batch;
    assert.equal(plannedBatch.batchType, "PLANNED_PRODUCTION");
    assert.equal(plannedBatch.plannedReason, "Festival Demand - Diwali");
    assert.equal(plannedBatch.priority, "HIGH");
    assert.equal(plannedBatch.plannedQuantity, 20);
    assert.equal(plannedBatch.unit, "kg");
    assert.equal(plannedBatch.relatedOrders.length, 0, "Planned batch must have NO related orders");
  });

  // =========================================================================
  // TEST 2: Rejects Invalid Planned Batch (Negative Quantity & Non-existent Product)
  // =========================================================================
  await t.test("2. Rejects scheduling batch with zero/negative quantity or invalid product", async () => {
    const invalidQtyRes = await request(app)
      .post("/api/v1/production/batches")
      .set(auth(USER_ROLES.OWNER))
      .send({
        product: product._id.toString(),
        productVariant: variantId.toString(),
        plannedQuantity: -5,
        batchType: "PLANNED_PRODUCTION",
      });
    assert.equal(invalidQtyRes.status, 400);

    const invalidProdRes = await request(app)
      .post("/api/v1/production/batches")
      .set(auth(USER_ROLES.OWNER))
      .send({
        product: "65b4c48924f0c436b1234567",
        productVariant: variantId.toString(),
        plannedQuantity: 10,
        batchType: "PLANNED_PRODUCTION",
      });
    assert.ok([400, 404].includes(invalidProdRes.status));
  });

  // =========================================================================
  // TEST 3: Baker Accepts, Verifies, Bakes, Records Output, Packages & Completes Batch
  // =========================================================================
  await t.test("3. Baker workflow: 20 kg planned -> 18 kg produced -> 15 kg packaged -> Finished stock becomes 15 kg", async () => {
    const planPayload = {
      batchNumber: plannedBatch.batchNumber,
      product: product._id.toString(),
      plannedQuantity: plannedBatch.plannedQuantity,
      relatedOrders: [],
      assignedWorkers: [users[USER_ROLES.PRODUCTION_STAFF].user._id.toString()],
    };

    // 3a. Accept batch
    const acceptRes = await request(app)
      .post(`/api/v1/production/batches/${plannedBatch._id}/accept`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send(planPayload);
    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.body.data.batch.status, "ACCEPTED");

    // 3b. Verify batch
    const verifyRes = await request(app)
      .post(`/api/v1/production/batches/${plannedBatch._id}/verify`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send(planPayload);
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.data.batch.status, "VERIFIED");

    // 3c. Start baking
    const startRes = await request(app)
      .post(`/api/v1/production/batches/${plannedBatch._id}/start`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({});
    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.data.batch.status, "IN_PRODUCTION");

    // 3d. Record baking output (18 kg produced usable out of 20 kg planned)
    const outputRes = await request(app)
      .post(`/api/v1/production/batches/${plannedBatch._id}/complete`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({
        outputQuantity: 18,
        usableQuantity: 18,
        producedQuantity: 18,
        outputUnit: "kg",
        outputRemark: "Batch baked with golden crust. 18 kg usable net yield.",
      });
    assert.equal(outputRes.status, 200);
    assert.equal(outputRes.body.data.batch.status, "PACKAGING");

    // 3e. Record packaging (15 kg packaged into three 5 kg boxes, leaving 3 kg unpackaged/WIP)
    const packageRes = await request(app)
      .post(`/api/v1/production/batches/${plannedBatch._id}/package`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({
        packagedQuantity: 15,
        packages: [
          { packageNumber: 1, quantity: 5, unit: "kg", remark: "Box 1" },
          { packageNumber: 2, quantity: 5, unit: "kg", remark: "Box 2" },
          { packageNumber: 3, quantity: 5, unit: "kg", remark: "Box 3" },
        ],
        packagingRemark: "15 kg packaged for Diwali festival stock; 3 kg remaining in pantry as loose stock/WIP",
      });
    assert.equal(packageRes.status, 200);
    const packagedBatch = packageRes.body.data.batch;
    assert.equal(packagedBatch.status, "PACKAGED");
    assert.equal(packagedBatch.packagedQuantity, 15);
    assert.equal(packagedBatch.unpackagedQuantity, 3, "Remaining 3 kg should be tracked as unpackaged");

    // 3f. Complete batch
    const completeRes = await request(app)
      .post(`/api/v1/production/batches/${plannedBatch._id}/finalize`)
      .set(auth(USER_ROLES.PRODUCTION_STAFF))
      .send({});
    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.data.batch.status, "COMPLETED");

    // Verify finished product stock has exactly 15 kg on hand!
    const stockRecord = await FinishedProductStock.findOne({ product: product._id, variant: variantId });
    assert.ok(stockRecord, "Stock record must exist");
    assert.equal(stockRecord.onHandQuantity, 15, "Finished goods on hand should be 15 kg");
    assert.equal(stockRecord.reservedQuantity, 0, "No stock should be reserved yet");

    // Check stock history entry
    const outputHistory = stockRecord.history.find((h) => h.action === "PRODUCTION_OUTPUT");
    assert.ok(outputHistory, "Stock history must record PRODUCTION_OUTPUT");
    assert.equal(outputHistory.quantity, 15);
  });

  // =========================================================================
  // TEST 4: Customer Orders 3 kg of Butter Cookies -> Fulfill from Stock
  // =========================================================================
  let customerOrder;
  await t.test("4. Customer places 3 kg order; fulfilled 100% from available finished stock", async () => {
    // 4a. Add 3 kg to cart
    const cartRes = await request(app)
      .post("/api/v1/cart/items")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        productId: product._id.toString(),
        variantId: variantId.toString(),
        quantity: 3,
      });
    console.log("TEST 4 CART RES:", JSON.stringify(cartRes.body));
    assert.equal(cartRes.status, 200);

    // 4b. Place order (Direct UPI Payment / Manual UPI)
    const orderRes = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        deliveryDate: tomorrowStr,
        deliveryTimeSlot: "14:00 - 16:00",
        orderType: "PICKUP",
        paymentMethod: "MANUAL_UPI",
        contactName: "Diwali Shopper",
        contactPhone: "9876543210",
      });

    console.log("TEST 4 ORDER RES:", JSON.stringify(orderRes.body));
    assert.equal(orderRes.status, 201, `Failed to create order: ${JSON.stringify(orderRes.body)}`);
    customerOrder = orderRes.body.data.order;
    assert.ok(customerOrder, "Order should be created");

    // Verify finished stock reservation:
    // 3 kg must be reserved from available finished stock!
    const stockAfterOrder = await FinishedProductStock.findOne({ product: product._id, variant: variantId });
    assert.equal(stockAfterOrder.onHandQuantity, 15);
    assert.equal(stockAfterOrder.reservedQuantity, 3, "3 kg should be reserved for the customer order");
    assert.equal(stockAfterOrder.onHandQuantity - stockAfterOrder.reservedQuantity, 12, "Available stock should be 12 kg");

    // Verify order finishedCommitments
    const fetchedOrder = await Order.findById(customerOrder._id);
    assert.equal(fetchedOrder.finishedCommitments.length, 1);
    assert.equal(fetchedOrder.finishedCommitments[0].quantity, 3);
    assert.equal(fetchedOrder.fulfillmentSummary?.type, "FULFILLED_FROM_STOCK");
    assert.equal(fetchedOrder.fulfillmentSummary?.isFullyInStock, true);
    assert.equal(fetchedOrder.fulfillmentSummary?.remainingToProduce, 0);
  });

  // =========================================================================
  // TEST 5: Owner Confirms Order and Fulfills from Stock (Zero Batches Created!)
  // =========================================================================
  await t.test("5. Owner confirms order: zero production batches created and order moves to READY", async () => {
    // Confirm payment first so order is CONFIRMED
    await Order.updateOne(
      { _id: customerOrder._id },
      { $set: { paymentStatus: "PAYMENT_CONFIRMED", status: "CONFIRMED" } }
    );

    // Count batches before assignment
    const batchesBefore = await ProductionBatch.countDocuments({ relatedOrders: customerOrder._id });
    assert.equal(batchesBefore, 0);

    // Assign order to production (confirm stock fulfillment)
    const assignRes = await request(app)
      .post(`/api/v1/production/orders/${customerOrder._id}/assign`)
      .set(auth(USER_ROLES.OWNER))
      .send({ workers: [] });

    assert.ok([200, 201].includes(assignRes.status), `Assign failed: ${JSON.stringify(assignRes.body)}`);
    assert.equal(assignRes.body.data.batches.length, 0, "No new batches should be created when 100% in stock!");

    // Verify order status automatically transitioned to READY
    const updatedOrder = await Order.findById(customerOrder._id);
    assert.equal(updatedOrder.status, "READY", "Order should be READY since stock was immediately available");

    const batchesAfter = await ProductionBatch.countDocuments({ relatedOrders: customerOrder._id });
    assert.equal(batchesAfter, 0, "Zero unnecessary production batches must be scheduled");
  });

  // =========================================================================
  // TEST 6: Order Completion Consumes Stock Atomically
  // =========================================================================
  await t.test("6. Completing order consumes stock: on-hand drops to 12 kg, reserved drops to 0", async () => {
    const completeOrderRes = await request(app)
      .patch(`/api/v1/orders/${customerOrder._id}/status`)
      .set(auth(USER_ROLES.OWNER))
      .send({ status: "COMPLETED" });

    assert.equal(completeOrderRes.status, 200);

    const stockFinal = await FinishedProductStock.findOne({ product: product._id, variant: variantId });
    assert.equal(stockFinal.onHandQuantity, 12, "On hand quantity should now be 12 kg (15 - 3)");
    assert.equal(stockFinal.reservedQuantity, 0, "Reserved quantity should drop back to 0");

    const fulfillHistory = stockFinal.history.find((h) => h.action === "ORDER_FULFILLED");
    assert.ok(fulfillHistory, "ORDER_FULFILLED history entry must be logged");
    assert.equal(fulfillHistory.quantity, 3);
  });

  // =========================================================================
  // TEST 7: Partial Stock Order (Customer Orders 15 kg when 12 kg available)
  // =========================================================================
  let partialOrder;
  await t.test("7. Partial stock fulfillment: 12 kg reserved from finished stock, batch planned ONLY for 3 kg remainder", async () => {
    // Customer adds 15 kg to cart
    await request(app)
      .post("/api/v1/cart/items")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        productId: product._id.toString(),
        variantId: variantId.toString(),
        quantity: 15,
      });

    const orderRes = await request(app)
      .post("/api/v1/orders")
      .set(auth(USER_ROLES.CUSTOMER))
      .send({
        deliveryDate: tomorrowStr,
        deliveryTimeSlot: "16:00 - 18:00",
        orderType: "DELIVERY",
        paymentMethod: "MANUAL_UPI",
        contactName: "Diwali Corporate Client",
        contactPhone: "9876543211",
        deliveryAddress: { addressLine1: "123 Commercial Ave", city: "Bakery City", postalCode: "110001" },
      });

    assert.equal(orderRes.status, 201, `Test 7 order failed: ${JSON.stringify(orderRes.body)}`);
    partialOrder = orderRes.body.data.order;

    // Check reservations: 12 kg finished goods reserved (all available), remaining 3 kg requires kitchen baking
    const stockAfterPartial = await FinishedProductStock.findOne({ product: product._id, variant: variantId });
    assert.equal(stockAfterPartial.onHandQuantity, 12);
    assert.equal(stockAfterPartial.reservedQuantity, 12, "All 12 kg available finished stock must be reserved");

    const fetchedPartial = await Order.findById(partialOrder._id);
    assert.equal(fetchedPartial.fulfillmentSummary?.type, "PARTIAL_STOCK");
    assert.equal(fetchedPartial.fulfillmentSummary?.totalFinishedReserved, 12);
    assert.equal(fetchedPartial.fulfillmentSummary?.remainingToProduce, 3);

    // Confirm payment
    await Order.updateOne(
      { _id: partialOrder._id },
      { $set: { paymentStatus: "PAYMENT_CONFIRMED", status: "CONFIRMED" } }
    );

    // Assign to production: should create a batch for ONLY 3 kg, NOT 15 kg!
    const assignRes = await request(app)
      .post(`/api/v1/production/orders/${partialOrder._id}/assign`)
      .set(auth(USER_ROLES.OWNER))
      .send({
        workers: [users[USER_ROLES.PRODUCTION_STAFF].user._id.toString()],
      });

    assert.ok([200, 201].includes(assignRes.status));
    assert.equal(assignRes.body.data.batches.length, 1);
    const partialBatch = assignRes.body.data.batches[0];
    assert.equal(partialBatch.plannedQuantity, 3, "Planned batch must ONLY be for the remaining 3 kg");
  });

  // =========================================================================
  // TEST 8: Order Cancellation Releases Finished Stock Reservation
  // =========================================================================
  await t.test("8. Cancelling order releases reserved finished goods stock atomically", async () => {
    const cancelRes = await request(app)
      .post(`/api/v1/orders/${partialOrder._id}/cancel`)
      .set(auth(USER_ROLES.OWNER))
      .send({ reason: "Customer requested cancellation before production finished" });

    assert.equal(cancelRes.status, 200);

    const stockAfterCancel = await FinishedProductStock.findOne({ product: product._id, variant: variantId });
    assert.equal(stockAfterCancel.onHandQuantity, 12);
    assert.equal(stockAfterCancel.reservedQuantity, 0, "Reserved stock must be released back to 0");

    const releaseHistory = stockAfterCancel.history.find((h) => h.action === "ORDER_RELEASED");
    assert.ok(releaseHistory, "ORDER_RELEASED history entry must be logged");
    assert.equal(releaseHistory.quantity, 12);
  });
});
