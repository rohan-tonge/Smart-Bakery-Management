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
import Payment from "../src/models/payment.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import InventoryTransaction from "../src/models/inventoryTransaction.model.js";
import Recipe from "../src/models/recipe.model.js";
import Setting from "../src/models/setting.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";
import { getBakeryTomorrowString } from "../src/utils/date.utils.js";

test("Phase 6: cart ownership, authoritative pricing, feasibility, and order reservations", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tomorrowStr = getBakeryTomorrowString();
  const users = {};
  for (const role of [USER_ROLES.CUSTOMER, USER_ROLES.OWNER, USER_ROLES.MANAGER]) {
    const user = await User.create({ name: `Phase 6 ${role}`, email: `${role.toLowerCase()}-${suffix}@orders-test.com`, password: "Password123!", role });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });
  let category; let product; let ingredient; let recipe; let orderId; let capacityOrderId; let productionStaff; let previousActiveStaffIds = [];
  t.after(async () => {
    const customerId = users[USER_ROLES.CUSTOMER].user._id;
    await Order.deleteMany({ customer: customerId });
    await Cart.deleteMany({ customer: customerId });
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
    await User.deleteMany({ email: new RegExp(`${suffix}\\@orders-test\\.com$`) });
    if (productionStaff) await User.deleteOne({ _id: productionStaff._id });
    if (previousActiveStaffIds.length) await User.updateMany({ _id: { $in: previousActiveStaffIds } }, { $set: { isActive: true } });
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
    await disconnectDb();
  });
  category = await Category.create({ name: `Orders ${suffix}`, slug: `orders-${suffix}` });
  product = await Product.create({ name: `Cake ${suffix}`, slug: `cake-${suffix}`, category: category._id, isActive: true, isAvailable: true, variants: [{ name: "Small", quantity: 1, unit: "piece", price: 125, isActive: true, isAvailable: true }] });
  const variantId = product.variants[0]._id;
  await FinishedProductStock.create({ product: product._id, variant: variantId, onHandQuantity: 8, reservedQuantity: 0, updatedBy: users[USER_ROLES.OWNER].user._id });
  ingredient = await Ingredient.create({ name: `Flour ${suffix}`, slug: `flour-${suffix}`, unit: "g", minimumStock: 25 });
  recipe = await Recipe.create({ product: product._id, variant: variantId, expectedYield: 2, yieldUnit: "piece", ingredients: [{ ingredient: ingredient._id, quantity: 100, unit: "g" }] });
  await InventoryLot.create({ ingredient: ingredient._id, lotNumber: `LOT-${suffix}`, originalQuantity: 150, remainingQuantity: 150, unit: "g", unitCost: 0, purchaseDate: new Date(), status: "AVAILABLE" });
  await t.test("customer cart prices are live, merging quantities and enforcing ownership", async () => {
    const tampered = await request(app).post("/api/v1/cart/items").set(auth(USER_ROLES.CUSTOMER)).send({ productId: product._id, variantId, quantity: 2, unitPrice: 0 });
    assert.equal(tampered.status, 400);
    const add = await request(app).post("/api/v1/cart/items").set(auth(USER_ROLES.CUSTOMER)).send({ productId: product._id, variantId, quantity: 2 });
    assert.equal(add.status, 200); assert.equal(add.body.data.subtotal, 250);
    const merged = await request(app).post("/api/v1/cart/items").set(auth(USER_ROLES.CUSTOMER)).send({ productId: product._id, variantId, quantity: 1 });
    assert.equal(merged.body.data.cart.items.length, 1); assert.equal(merged.body.data.cart.items[0].quantity, 3);
    assert.equal((await request(app).get("/api/v1/cart").set(auth(USER_ROLES.OWNER))).status, 403);
    const bad = await request(app).post("/api/v1/cart/items").set(auth(USER_ROLES.CUSTOMER)).send({ productId: "bad", variantId, quantity: 1 });
    assert.equal(bad.status, 400);
  });

  await t.test("feasibility is read-only and checkout stores price snapshots and reserves finished stock", async () => {
    const before = await FinishedProductStock.findOne({ product: product._id });
    const feasible = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({ items: [{ productId: product._id, variantId, quantity: 3 }] });
    assert.equal(feasible.status, 200); assert.equal(feasible.body.data.feasible, true);
    assert.equal((await FinishedProductStock.findById(before._id)).reservedQuantity, 0);
    const inventoryTransactionsBefore = await InventoryTransaction.countDocuments({ ingredient: ingredient._id });
    const scaled = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({ items: [{ productId: product._id, variantId, quantity: 10 }] });
    assert.equal(scaled.body.data.feasible, false);
    assert.equal(scaled.body.data.production.estimatedRecipeBatches, 1);
    assert.equal(scaled.body.data.checks.capacityReady, false);
    assert.equal(scaled.body.data.ingredientRequirements, undefined);
    assert.equal(await InventoryTransaction.countDocuments({ ingredient: ingredient._id }), inventoryTransactionsBefore);
    const priceTampered = await request(app).post("/api/v1/orders").set(auth(USER_ROLES.CUSTOMER)).send({ orderType: "PICKUP", contactName: "Bakery Customer", contactPhone: "9876543210", deliveryDate: tomorrowStr, total: 0 });
    assert.equal(priceTampered.status, 400);
    const unsupportedPayment = await request(app).post("/api/v1/orders").set(auth(USER_ROLES.CUSTOMER)).send({ orderType: "PICKUP", contactName: "Bakery Customer", contactPhone: "9876543210", deliveryDate: tomorrowStr, paymentMethod: "CARD" });
    assert.equal(unsupportedPayment.status, 400);
    const walletBypass = await request(app).post("/api/v1/orders").set(auth(USER_ROLES.CUSTOMER)).send({ orderType: "PICKUP", contactName: "Bakery Customer", contactPhone: "9876543210", deliveryDate: tomorrowStr, paymentMethod: "WALLET" });
    assert.equal(walletBypass.status, 400);
    const created = await request(app).post("/api/v1/orders").set(auth(USER_ROLES.CUSTOMER)).send({ orderType: "PICKUP", contactName: "Bakery Customer", contactPhone: "9876543210", deliveryDate: tomorrowStr });
    assert.equal(created.status, 201, JSON.stringify(created.body)); orderId = created.body.data.order._id;
    assert.equal(created.body.data.order.total, 375); assert.equal(created.body.data.order.items[0].unitPrice, 125);
    assert.equal(created.body.data.order.paymentMethod, "MANUAL_UPI");
    assert.equal(created.body.data.order.status, "PENDING_PAYMENT");
    assert.equal(created.body.data.order.paymentStatus, "PAYMENT_PENDING");
    assert.ok(created.body.data.order.reservationExpiresAt);
    assert.equal(await Payment.countDocuments({ order: orderId }), 0);
    assert.equal((await FinishedProductStock.findById(before._id)).reservedQuantity, 3);
    const mine = await request(app).get("/api/v1/orders/my").set(auth(USER_ROLES.CUSTOMER));
    assert.equal(mine.status, 200);
    assert.ok(mine.body.data.orders.some((order) => order._id === orderId));
    assert.equal((await request(app).get("/api/v1/orders/my").set(auth(USER_ROLES.MANAGER))).status, 403);
    const reordered = await request(app).post(`/api/v1/orders/${orderId}/reorder`).set(auth(USER_ROLES.CUSTOMER));
    assert.equal(reordered.status, 200, reordered.body.message);
    assert.deepEqual(reordered.body.data.unavailable, []);
    assert.equal(reordered.body.data.cart.items[0].quantity, 3);
    assert.equal((await request(app).post(`/api/v1/orders/${orderId}/reorder`).set(auth(USER_ROLES.MANAGER))).status, 403);
    const stockSet = await request(app).put("/api/v1/orders/finished-stock").set(auth(USER_ROLES.OWNER)).send({ productId: product._id, variantId, onHandQuantity: 10 });
    assert.equal(stockSet.status, 200, stockSet.body.message);
    assert.equal(stockSet.body.data.stock.reservedQuantity, 3);
    const belowReserved = await request(app).put("/api/v1/orders/finished-stock").set(auth(USER_ROLES.OWNER)).send({ productId: product._id, variantId, onHandQuantity: 2 });
    assert.equal(belowReserved.status, 409);
    assert.equal((await request(app).put("/api/v1/orders/finished-stock").set(auth(USER_ROLES.CUSTOMER)).send({ productId: product._id, variantId, onHandQuantity: 10 })).status, 403);
    await Product.updateOne({ _id: product._id, "variants._id": variantId }, { $set: { "variants.$.price": 150 } });
    assert.equal((await Order.findById(orderId)).items[0].unitPrice, 125);
  });

  await t.test("cart quantity updates, item removal, and clearing preserve totals", async () => {
    const before = await request(app).get("/api/v1/cart").set(auth(USER_ROLES.CUSTOMER));
    const itemId = before.body.data.cart.items[0]._id;
    assert.equal(before.body.data.subtotal, 450);
    const updated = await request(app).patch(`/api/v1/cart/items/${itemId}`).set(auth(USER_ROLES.CUSTOMER)).send({ quantity: 4 });
    assert.equal(updated.status, 200, updated.body.message);
    assert.equal(updated.body.data.subtotal, 600);
    assert.equal((await request(app).patch(`/api/v1/cart/items/${itemId}`).set(auth(USER_ROLES.CUSTOMER)).send({ quantity: 0 })).status, 400);
    assert.equal((await request(app).delete(`/api/v1/cart/items/${itemId}`).set(auth(USER_ROLES.CUSTOMER))).body.data.subtotal, 0);
    assert.equal((await request(app).delete(`/api/v1/cart/items/${itemId}`).set(auth(USER_ROLES.CUSTOMER))).status, 404);
    const add = await request(app).post("/api/v1/cart/items").set(auth(USER_ROLES.CUSTOMER)).send({ productId: product._id, variantId, quantity: 2 });
    assert.equal(add.body.data.subtotal, 300);
    const cleared = await request(app).delete("/api/v1/cart").set(auth(USER_ROLES.CUSTOMER));
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.subtotal, 0);
    assert.equal((await request(app).delete("/api/v1/cart").set(auth(USER_ROLES.MANAGER))).status, 403);
  });

  await t.test("customer isolation, invalid status transitions, cancellation releases reservations", async () => {
    const other = await User.create({ name: "Other", email: `other-${suffix}@orders-test.com`, password: "Password123!", role: USER_ROLES.CUSTOMER });
    const otherToken = generateAccessToken(other);
    assert.equal((await request(app).get(`/api/v1/orders/${orderId}`).set({ Authorization: `Bearer ${otherToken}` })).status, 404);
    assert.equal((await request(app).patch(`/api/v1/orders/${orderId}/status`).set(auth(USER_ROLES.CUSTOMER)).send({ status: "CONFIRMED" })).status, 403);
    assert.equal((await request(app).patch(`/api/v1/orders/${orderId}/status`).set(auth(USER_ROLES.OWNER)).send({ status: "COMPLETED" })).status, 409);
    const cancelled = await request(app).post(`/api/v1/orders/${orderId}/cancel`).set(auth(USER_ROLES.CUSTOMER)).send({ reason: "Changed my mind" });
    assert.equal(cancelled.status, 200); assert.equal(cancelled.body.data.order.status, "CANCELLED");
    const stock = await FinishedProductStock.findOne({ product: product._id }); assert.equal(stock.reservedQuantity, 0);
    await User.deleteOne({ _id: other._id });
  });

  await t.test("guest checkout retries reuse one order and concurrent buyers cannot reserve the last unit twice", async () => {
    const payload = {
      orderType: "PICKUP", paymentMethod: "MANUAL_UPI", contactPhone: "9876500001", contactName: "Guest Tester", deliveryDate: tomorrowStr,
      guestId: `idempotent-${suffix}`,
      items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
    };
    const first = await request(app).post("/api/v1/orders").set("Idempotency-Key", `checkout-${suffix}`).send(payload);
    assert.equal(first.status, 201, first.body.message);
    const retry = await request(app).post("/api/v1/orders").set("Idempotency-Key", `checkout-${suffix}`).send(payload);
    assert.equal(retry.status, 201, retry.body.message);
    assert.equal(retry.body.data.order._id, first.body.data.order._id);
    await Order.deleteOne({ _id: first.body.data.order._id });
    await FinishedProductStock.updateOne({ product: product._id, variant: variantId }, { $inc: { reservedQuantity: -1 } });

    await FinishedProductStock.updateOne({ product: product._id, variant: variantId }, { $set: { onHandQuantity: 1, reservedQuantity: 0 } });
    const compete = (guestId, phone) => request(app).post("/api/v1/orders").send({
      orderType: "PICKUP", paymentMethod: "MANUAL_UPI", contactPhone: phone, contactName: "Competitor", deliveryDate: tomorrowStr, guestId,
      items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
    });
    const [left, right] = await Promise.all([
      compete(`race-a-${suffix}`, "9876500002"),
      compete(`race-b-${suffix}`, "9876500003"),
    ]);
    assert.equal([left, right].filter((response) => response.status === 201).length, 1);
    assert.equal((await FinishedProductStock.findOne({ product: product._id, variant: variantId })).reservedQuantity, 1);
    await Order.deleteMany({ guestId: { $in: [`race-a-${suffix}`, `race-b-${suffix}`] } });
    await FinishedProductStock.updateOne({ product: product._id, variant: variantId }, { $set: { onHandQuantity: 8, reservedQuantity: 0 } });
  });

  await t.test("on-demand fulfillment is blocked until production capacity is configured", async () => {
    await Setting.deleteOne({ key: "PRODUCTION_CAPACITY" });
    await InventoryLot.deleteMany({ ingredient: ingredient._id });
    await Ingredient.updateOne({ _id: ingredient._id }, { $set: { unit: "kg", minimumStock: 3, reservedStock: 0, productionReservedStock: 0 } });
    await Recipe.updateOne({ _id: recipe._id }, { $set: { "ingredients.0.quantity": 0.3, "ingredients.0.unit": "kg" } });
    await InventoryLot.create({ ingredient: ingredient._id, lotNumber: `LOT-DECIMAL-${suffix}`, originalQuantity: 3.6, remainingQuantity: 3.6, unit: "kg", unitCost: 0, purchaseDate: new Date(), status: "AVAILABLE" });
    await Recipe.updateOne({ _id: recipe._id }, { $set: { preparationTime: 15, productionTime: 45 } });
    await FinishedProductStock.updateOne({ product: product._id, variant: variantId }, { $set: { onHandQuantity: 0, reservedQuantity: 0 } });

    const added = await request(app).post("/api/v1/cart/items").set(auth(USER_ROLES.CUSTOMER)).send({ productId: product._id, variantId, quantity: 1 });
    assert.equal(added.status, 200, added.body.message);
    const feasibility = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({ items: [{ productId: product._id, variantId, quantity: 1 }] });
    assert.equal(feasibility.status, 200);
    assert.equal(feasibility.body.data.feasible, false);
    assert.equal(feasibility.body.data.checks.ingredients, true);
    assert.equal(feasibility.body.data.checks.capacityReady, false);
    assert.match(feasibility.body.data.checks.capacityReason, /owner must configure/i);

    const checkout = await request(app).post("/api/v1/orders").set(auth(USER_ROLES.CUSTOMER)).send({ orderType: "PICKUP", contactName: "Bakery Customer", contactPhone: "9876543210", paymentMethod: "MANUAL_UPI", deliveryDate: tomorrowStr });
    assert.equal(checkout.status, 409, checkout.body.message);
    const reserved = await Ingredient.findById(ingredient._id);
    assert.equal(reserved.reservedStock, 0);

    const unauthorizedConfig = await request(app).put("/api/v1/settings/production-capacity").set(auth(USER_ROLES.CUSTOMER)).send({});
    assert.equal(unauthorizedConfig.status, 403);
    const invalidConfig = await request(app).put("/api/v1/settings/production-capacity").set(auth(USER_ROLES.OWNER)).send({
      workingHours: { open: "08:00", close: "18:00" }, slotMinutes: 700,
      minutesPerStaffPerDay: 60, ovens: [{ name: "Oven A", minutesPerDay: 60 }],
    });
    assert.equal(invalidConfig.status, 400);
    const noStaffConfig = await request(app).put("/api/v1/settings/production-capacity").set(auth(USER_ROLES.OWNER)).send({
      workingHours: { open: "08:00", close: "18:00" }, slotMinutes: 60,
      minutesPerStaffPerDay: 60, ovens: [{ name: "Oven A", minutesPerDay: 60 }],
    });
    assert.equal(noStaffConfig.status, 200, noStaffConfig.body.message);
    previousActiveStaffIds = (await User.find({ role: USER_ROLES.PRODUCTION_STAFF, isActive: true }).select("_id")).map((staff) => staff._id);
    await User.updateMany({ role: USER_ROLES.PRODUCTION_STAFF, isActive: true }, { $set: { isActive: false } });
    const noStaff = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({ items: [{ productId: product._id, variantId, quantity: 1 }] });
    assert.equal(noStaff.body.data.checks.capacity, "STAFF_UNAVAILABLE");
    if (previousActiveStaffIds.length) await User.updateMany({ _id: { $in: previousActiveStaffIds } }, { $set: { isActive: true } });
    previousActiveStaffIds = [];
    productionStaff = await User.create({ name: `Production Staff ${suffix}`, email: `staff-${suffix}@orders-test.com`, password: "Password123!", role: USER_ROLES.PRODUCTION_STAFF, isActive: true });
    const staffDenied = await request(app).put("/api/v1/settings/production-capacity").set({ Authorization: `Bearer ${generateAccessToken(productionStaff)}` }).send({
      workingHours: { open: "08:00", close: "18:00" }, slotMinutes: 60,
      minutesPerStaffPerDay: 60, ovens: [{ name: "Oven A", minutesPerDay: 60 }],
    });
    assert.equal(staffDenied.status, 403);
    const configuration = await request(app).put("/api/v1/settings/production-capacity").set(auth(USER_ROLES.OWNER)).send({
      workingHours: { open: "08:00", close: "18:00" }, slotMinutes: 60,
      minutesPerStaffPerDay: 60, ovens: [{ name: "Oven A", minutesPerDay: 60 }],
    });
    assert.equal(configuration.status, 200, configuration.body.message);
    const managerCapacity = await request(app).get("/api/v1/settings/production-capacity").set(auth(USER_ROLES.MANAGER));
    assert.equal(managerCapacity.status, 200);
    await InventoryLot.updateOne({ ingredient: ingredient._id, lotNumber: `LOT-DECIMAL-${suffix}` }, { $set: { originalQuantity: 3.1, remainingQuantity: 3.1 } });
    const insufficient = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({ items: [{ productId: product._id, variantId, quantity: 1 }] });
    assert.equal(insufficient.body.data.feasible, false);
    assert.equal(insufficient.body.data.checks.capacityReady, true);
    assert.equal(insufficient.body.data.checks.ingredients, false);
    assert.ok(insufficient.body.data.shortages.length > 0);
    await InventoryLot.updateOne({ ingredient: ingredient._id, lotNumber: `LOT-DECIMAL-${suffix}` }, { $set: { originalQuantity: 3.6, remainingQuantity: 3.6 } });
    const feasible = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({ items: [{ productId: product._id, variantId, quantity: 1 }] });
    assert.equal(feasible.body.data.feasible, true, JSON.stringify(feasible.body.data));
    assert.equal(feasible.body.data.checks.capacityReady, true);
    const successfulCheckout = await request(app).post("/api/v1/orders").set(auth(USER_ROLES.CUSTOMER)).send({ orderType: "PICKUP", contactName: "Bakery Customer", contactPhone: "9876543210", paymentMethod: "MANUAL_UPI", deliveryDate: tomorrowStr });
    assert.equal(successfulCheckout.status, 201, successfulCheckout.body.message);
    capacityOrderId = successfulCheckout.body.data.order._id;
    assert.equal(successfulCheckout.body.data.order.capacityCommitment.minutes, 60);
    const full = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({ items: [{ productId: product._id, variantId, quantity: 1 }] });
    assert.equal(full.body.data.feasible, false);
    assert.equal(full.body.data.checks.capacity, "CAPACITY_FULL");
    const cancelledCapacityOrder = await request(app).post(`/api/v1/orders/${capacityOrderId}/cancel`).set(auth(USER_ROLES.CUSTOMER)).send({ reason: "Capacity reservation test" });
    assert.equal(cancelledCapacityOrder.status, 200, cancelledCapacityOrder.body.message);
    assert.equal(cancelledCapacityOrder.body.data.order.capacityCommitment.released, true);
    const availableAgain = await request(app).post("/api/v1/orders/check-feasibility").set(auth(USER_ROLES.CUSTOMER)).send({ items: [{ productId: product._id, variantId, quantity: 1 }] });
    assert.equal(availableAgain.body.data.feasible, true);

    const compete = (guestId, phone) => request(app).post("/api/v1/orders").send({
      orderType: "PICKUP", guestId, contactPhone: phone, contactName: "Competitor", deliveryDate: tomorrowStr,
      items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
    });
    const [left, right] = await Promise.all([
      compete(`capacity-a-${suffix}`, "9876500011"),
      compete(`capacity-b-${suffix}`, "9876500012"),
    ]);
    assert.equal([left, right].filter((response) => response.status === 201).length, 1);
    assert.equal([left, right].filter((response) => response.status === 409).length, 1);
    const reservationDay = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const capacitySetting = await Setting.findOne({ key: "PRODUCTION_CAPACITY" });
    assert.equal(capacitySetting.value.reservedByDay[reservationDay], 60);
    await Order.deleteMany({ guestId: { $in: [`capacity-a-${suffix}`, `capacity-b-${suffix}`] } });
    await Setting.updateOne({ key: "PRODUCTION_CAPACITY" }, { $set: { [`value.reservedByDay.${reservationDay}`]: 0 } });
    await Ingredient.updateOne({ _id: ingredient._id }, { $set: { reservedStock: 0 } });
  });
});
