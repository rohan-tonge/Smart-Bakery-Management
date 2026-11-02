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
import WastageRecord from "../src/models/wastageRecord.model.js";
import FinishedProductStock from "../src/models/finishedProductStock.model.js";
import Order from "../src/models/order.model.js";
import Payment from "../src/models/payment.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";
import { multiplyQuantityByRupees, rupeesToPaise } from "../src/utils/money.utils.js";

test("Phase 9: wastage, historical production cost, estimation, and profitability", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF, USER_ROLES.CUSTOMER]) {
    const user = await User.create({ name: `Phase 9 ${role}`, email: `${role.toLowerCase()}-${suffix}@phase9-test.com`, password: "Password123!", role, hourlyLabourRate: 999 });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });
  const category = await Category.create({ name: `Cost Category ${suffix}`, slug: `cost-category-${suffix}` });
  const product = await Product.create({ name: `Cost Cake ${suffix}`, slug: `cost-cake-${suffix}`, category: category._id, variants: [{ name: "Cake", quantity: 1, unit: "piece", price: 50 }] });
  const variantId = product.variants[0]._id;
  const ingredient = await Ingredient.create({ name: `Cost Flour ${suffix}`, slug: `cost-flour-${suffix}`, unit: "kg" });
  const recipe = await Recipe.create({ product: product._id, variant: variantId, ingredients: [{ ingredient: ingredient._id, quantity: 10, unit: "kg" }], expectedYield: 100, yieldUnit: "piece" });
  const lot40 = await InventoryLot.create({ ingredient: ingredient._id, lotNumber: `LOT40-${suffix}`, originalQuantity: 100, remainingQuantity: 100, unit: "kg", unitCost: 40, purchaseDate: new Date(), status: "AVAILABLE" });
  const lot60 = await InventoryLot.create({ ingredient: ingredient._id, lotNumber: `LOT60-${suffix}`, originalQuantity: 100, remainingQuantity: 100, unit: "kg", unitCost: 60, purchaseDate: new Date(), status: "AVAILABLE" });
  const estimateLot = await InventoryLot.create({ ingredient: ingredient._id, lotNumber: `EST-${suffix}`, originalQuantity: 100, remainingQuantity: 100, unit: "kg", unitCost: 70, purchaseDate: new Date(), status: "AVAILABLE" });
  let actualBatch; let rawBatch; let orderId;
  const batchPayload = {
    batchNumber: `P9-A-${suffix}`, product: product._id, productVariant: variantId,
    productSnapshot: { productName: product.name, variantName: "Cake", variantQuantity: 1, variantUnit: "piece" },
    recipe: recipe._id, recipeRevision: 1,
    recipeSnapshot: { expectedYield: 100, yieldUnit: "piece", recipeBatchQuantity: 1, ingredients: [{ ingredient: ingredient._id, name: ingredient.name, quantity: 10, unit: "kg" }] },
    plannedQuantity: 100, producedQuantity: 100, usableQuantity: 92, wastageQuantity: 8, unit: "piece", status: "COMPLETED",
    assignedWorkers: [{ worker: users.PRODUCTION_STAFF.user._id, hourlyRateSnapshot: 300, actualHours: 2 }], actualStartTime: new Date(), actualCompletionTime: new Date(), createdBy: users.OWNER.user._id,
    consumedIngredients: [
      { ingredient: ingredient._id, ingredientName: ingredient.name, lot: lot40._id, lotNumber: lot40.lotNumber, quantity: 50, unit: "kg", unitCostSnapshot: 40 },
      { ingredient: ingredient._id, ingredientName: ingredient.name, lot: lot60._id, lotNumber: lot60.lotNumber, quantity: 25, unit: "kg", unitCostSnapshot: 60 },
    ],
  };
  actualBatch = await ProductionBatch.create(batchPayload);
  rawBatch = await ProductionBatch.create({ ...batchPayload, batchNumber: `P9-RAW-${suffix}`, status: "IN_PRODUCTION", producedQuantity: undefined, usableQuantity: undefined, wastageQuantity: undefined, consumedIngredients: [], assignedWorkers: [{ worker: users.PRODUCTION_STAFF.user._id, hourlyRateSnapshot: 300, actualHours: null }] });
  const order = await Order.create({ orderNumber: `P9-ORD-${suffix}`, customer: users.CUSTOMER.user._id, items: [{ productId: product._id, variantId, productName: product.name, variantName: "Cake", quantity: 92, unitPrice: 50, lineTotal: 4600 }], subtotal: 4600, total: 4600, orderType: "PICKUP", contactName: "Cost Test", contactPhone: "1234567890", status: "DELIVERED", paymentSummary: { status: "CAPTURED", provider: "RAZORPAY" } });
  orderId = order._id;
  await ProductionBatch.updateOne({ _id: actualBatch._id }, { $set: { relatedOrders: [order._id] } });
  await Payment.create({ order: order._id, customer: users.CUSTOMER.user._id, amount: 460000, currency: "INR", status: "CAPTURED", providerOrderId: `rp-${suffix}`, providerPaymentId: `pay-${suffix}` });
  await FinishedProductStock.create({ product: product._id, variant: variantId, onHandQuantity: 92, reservedQuantity: 0, updatedBy: users.OWNER.user._id });

  t.after(async () => {
    await WastageRecord.deleteMany({ productionBatch: { $in: [actualBatch._id, rawBatch._id] } });
    await InventoryTransaction.deleteMany({ ingredient: ingredient._id });
    await ProductionBatch.deleteMany({ _id: { $in: [actualBatch._id, rawBatch._id] } });
    await InventoryLot.deleteMany({ _id: { $in: [lot40._id, lot60._id, estimateLot._id] } });
    await Payment.deleteMany({ order: orderId }); await Order.deleteOne({ _id: orderId });
    await FinishedProductStock.deleteMany({ product: product._id });
    await Recipe.deleteOne({ _id: recipe._id }); await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id }); await Ingredient.deleteOne({ _id: ingredient._id });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@phase9-test\\.com$`) });
    await disconnectDb();
  });

  await t.test("money helpers use deterministic paise and mixed historical lots", async () => {
    assert.equal(rupeesToPaise(100.25), 10025);
    assert.equal(multiplyQuantityByRupees(50, 40), 200000);
    assert.equal((await request(app).get(`/api/v1/production/batches/${actualBatch._id}/cost`).set(auth(USER_ROLES.MANAGER))).status, 403);
    const preview = await request(app).get(`/api/v1/production/batches/${actualBatch._id}/cost`).set(auth(USER_ROLES.OWNER));
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.cost.ingredientCost, 3500);
    assert.equal(preview.body.data.cost.labourCost, 600);
    assert.equal(preview.body.data.cost.status, "INCOMPLETE");
    assert.ok(preview.body.data.cost.incomplete.some((reason) => /output wastage/i.test(reason)));
  });

  await t.test("customers cannot see costs and wastage recording validates access and reasons", async () => {
    assert.equal((await request(app).get(`/api/v1/production/batches/${actualBatch._id}/cost`).set(auth(USER_ROLES.CUSTOMER))).status, 403);
    const base = { productionBatch: String(actualBatch._id), type: "PRODUCTION_OUTPUT", reason: "OVERCOOKED", quantity: 8, unit: "piece" };
    assert.equal((await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.CUSTOMER)).send(base)).status, 403);
    assert.equal((await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.MANAGER)).send({ ...base, reason: "MADE_UP" })).status, 400);
    const saved = await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.MANAGER)).send(base);
    assert.equal(saved.status, 201, saved.body.message);
    assert.equal(saved.body.data.wastage.valuePaise, 0);
    assert.equal((await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.MANAGER)).send(base)).status, 409);
    assert.equal((await FinishedProductStock.findOne({ product: product._id, variant: variantId })).onHandQuantity, 92);
  });

  await t.test("raw material wastage consumes lot stock once and records traceable transaction", async () => {
    const idempotencyKey = `raw-waste-${suffix}`;
    const input = { productionBatch: String(rawBatch._id), type: "RAW_MATERIAL", reason: "SPILLAGE", ingredient: String(ingredient._id), inventoryLot: String(lot40._id), quantity: 2, unit: "kg", idempotencyKey };
    assert.equal((await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.PRODUCTION_STAFF)).send({ ...input, productionBatch: "000000000000000000000000" })).status, 404);
    assert.equal((await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.PRODUCTION_STAFF)).send({ ...input, ingredient: "000000000000000000000000", idempotencyKey: `bad-ing-${suffix}` })).status, 400);
    assert.equal((await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.PRODUCTION_STAFF)).send({ ...input, quantity: 0, idempotencyKey: `bad-qty-${suffix}` })).status, 400);
    const saved = await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.PRODUCTION_STAFF)).send(input);
    assert.equal(saved.status, 201, saved.body.message);
    assert.equal(saved.body.data.wastage.valuePaise, 8000);
    assert.ok(saved.body.data.wastage.inventoryTransaction);
    assert.equal((await InventoryLot.findById(lot40._id)).remainingQuantity, 98);
    assert.equal(await InventoryTransaction.countDocuments({ referenceType: "WASTAGE", referenceId: saved.body.data.wastage._id, type: "WASTAGE" }), 1);
    const replay = await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.PRODUCTION_STAFF)).send(input);
    assert.equal(replay.status, 201);
    assert.equal((await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.PRODUCTION_STAFF)).send({ ...input, quantity: 3 })).status, 409);
    assert.equal(await InventoryTransaction.countDocuments({ referenceType: "WASTAGE", referenceId: saved.body.data.wastage._id }), 1);
    const packaging = { productionBatch: String(rawBatch._id), type: "PACKAGING", reason: "DAMAGED", quantity: 1, unit: "piece", idempotencyKey: `pack-waste-${suffix}` };
    assert.equal((await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.PRODUCTION_STAFF)).send(packaging)).status, 201);
    assert.equal((await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.PRODUCTION_STAFF)).send(packaging)).status, 201);
    assert.equal(await WastageRecord.countDocuments({ productionBatch: rawBatch._id, type: "PACKAGING" }), 1);
  });

  await t.test("owner finalizes immutable cost snapshot, labour/packaging/expenses and output waste", async () => {
    await ProductionBatch.updateOne({ _id: actualBatch._id }, { $set: { wastageWriteCount: 1 } });
    const whileWastageWriteActive = await request(app).post(`/api/v1/production/batches/${actualBatch._id}/cost/finalize`).set(auth(USER_ROLES.OWNER)).send({ packagingCost: 300 });
    assert.equal(whileWastageWriteActive.status, 409);
    await ProductionBatch.updateOne({ _id: actualBatch._id }, { $set: { wastageWriteCount: 0 } });
    const finalize = await request(app).post(`/api/v1/production/batches/${actualBatch._id}/cost/finalize`).set(auth(USER_ROLES.OWNER)).send({ packagingCost: 300, expenses: [{ description: "Oven electricity", amount: 100 }] });
    assert.equal(finalize.status, 200, finalize.body.message);
    assert.equal(finalize.body.data.cost.ingredientCost, 3500);
    assert.equal(finalize.body.data.cost.labourCost, 600);
    assert.equal(finalize.body.data.cost.packagingCost, 300);
    assert.equal(finalize.body.data.cost.otherExpense, 100);
    assert.equal(finalize.body.data.cost.totalCost, 4500);
    assert.equal(finalize.body.data.cost.costPerUsableItem, 48.91);
    const outputWaste = await WastageRecord.findOne({ productionBatch: actualBatch._id, type: "PRODUCTION_OUTPUT" });
    assert.equal(outputWaste.valuePaise, 39128);
    assert.equal(outputWaste.valueBasis, "PRODUCTION_COST");
    const outputWasteDetail = await request(app).get(`/api/v1/wastage/${outputWaste._id}`).set(auth(USER_ROLES.MANAGER));
    assert.equal(outputWasteDetail.status, 200);
    assert.equal(String(outputWasteDetail.body.data.wastage._id), String(outputWaste._id));
    assert.equal((await request(app).get(`/api/v1/wastage/${outputWaste._id}`).set(auth(USER_ROLES.CUSTOMER))).status, 403);
    const wastageList = await request(app).get("/api/v1/wastage?type=PRODUCTION_OUTPUT&limit=100").set(auth(USER_ROLES.MANAGER));
    assert.equal(wastageList.status, 200);
    assert.ok(wastageList.body.data.wastage.some((item) => String(item._id) === String(outputWaste._id)));
    const wastageSummary = await request(app).get("/api/v1/wastage/summary").set(auth(USER_ROLES.OWNER));
    assert.equal(wastageSummary.status, 200);
    assert.ok(wastageSummary.body.data.summary.some((item) => item.type === "PRODUCTION_OUTPUT"));
    assert.equal((await request(app).get("/api/v1/wastage/summary").set(auth(USER_ROLES.CUSTOMER))).status, 403);
    const lateOutputWaste = await request(app).post("/api/v1/wastage").set(auth(USER_ROLES.MANAGER)).send({ productionBatch: String(actualBatch._id), type: "PRODUCTION_OUTPUT", reason: "OVERCOOKED", quantity: 8, unit: "piece" });
    assert.equal(lateOutputWaste.status, 409);
    await InventoryLot.updateOne({ _id: lot40._id }, { $set: { unitCost: 99 } });
    await InventoryLot.updateOne({ _id: lot40._id }, { $set: { status: "BLOCKED" } });
    await InventoryLot.updateOne({ _id: lot60._id }, { $set: { status: "BLOCKED" } });
    await User.updateOne({ _id: users.PRODUCTION_STAFF.user._id }, { $set: { hourlyLabourRate: 9999 } });
    const historical = await request(app).get(`/api/v1/production/batches/${actualBatch._id}/cost`).set(auth(USER_ROLES.OWNER));
    assert.equal(historical.body.data.cost.totalCost, 4500);
    assert.equal(historical.body.data.cost.materialSnapshots[0].unitCostSnapshot, 40);
    const costSummary = await request(app).get("/api/v1/costing/summary").set(auth(USER_ROLES.OWNER));
    assert.equal(costSummary.status, 200);
    assert.ok(costSummary.body.data.summary.totalCost >= 4500);
    assert.equal((await request(app).get("/api/v1/costing/summary").set(auth(USER_ROLES.MANAGER))).status, 403);
    const batchProfitability = await request(app).get(`/api/v1/profitability/batches/${actualBatch._id}`).set(auth(USER_ROLES.MANAGER));
    assert.equal(batchProfitability.status, 200, batchProfitability.body.message);
    assert.equal(batchProfitability.body.data.profitability.batchNumber, actualBatch.batchNumber);
    const productProfitability = await request(app).get(`/api/v1/profitability/products/${product._id}`).set(auth(USER_ROLES.OWNER));
    assert.equal(productProfitability.status, 200);
    assert.equal(productProfitability.body.data.profitability.unitsSold, 92);
    const variantProfitability = await request(app).get(`/api/v1/profitability/variants/${variantId}`).set(auth(USER_ROLES.MANAGER));
    assert.equal(variantProfitability.status, 200);
    assert.equal(variantProfitability.body.data.profitability.unitsSold, 92);
    assert.equal((await request(app).post(`/api/v1/production/batches/${actualBatch._id}/cost/finalize`).set(auth(USER_ROLES.OWNER)).send({})).status, 409);
  });

  await t.test("estimate and price impact are read-only; revenue uses order price snapshot", async () => {
    const beforeCount = await ProductionBatch.countDocuments();
    const beforeLot = await InventoryLot.findById(estimateLot._id);
    const input = { product: String(product._id), productVariant: String(variantId), plannedQuantity: 100, labour: [{ worker: String(users.PRODUCTION_STAFF.user._id), hours: 1 }] };
    assert.equal((await request(app).post("/api/v1/costing/estimate").set(auth(USER_ROLES.MANAGER)).send(input)).status, 403);
    const estimate = await request(app).post("/api/v1/costing/estimate").set(auth(USER_ROLES.OWNER)).send(input);
    assert.equal(estimate.status, 200, estimate.body.message);
    assert.equal(estimate.body.data.costType, "ESTIMATED");
    assert.equal(estimate.body.data.ingredientCost, 700);
    assert.equal(estimate.body.data.labourCost, 9999);
    const impact = await request(app).post("/api/v1/costing/price-impact").set(auth(USER_ROLES.OWNER)).send({ ...input, changes: [{ ingredient: String(ingredient._id), increasePercent: 20 }] });
    assert.equal(impact.status, 200);
    assert.equal(impact.body.data.simulationType, "ESTIMATE");
    assert.equal(impact.body.data.simulatedEstimatedCost, 10839);
    assert.equal(await ProductionBatch.countDocuments(), beforeCount);
    assert.equal((await InventoryLot.findById(estimateLot._id)).remainingQuantity, beforeLot.remainingQuantity);
    await Product.updateOne({ _id: product._id, "variants._id": variantId }, { $set: { "variants.$.price": 99 } });
    const profitability = await request(app).get(`/api/v1/profitability/orders/${orderId}`).set(auth(USER_ROLES.MANAGER));
    assert.equal(profitability.status, 200);
    assert.equal(profitability.body.data.profitability.revenue, 4600);
  });

  await t.test("incomplete labour and negative expenses cannot be finalized", async () => {
    assert.equal((await request(app).post(`/api/v1/production/batches/${rawBatch._id}/cost/finalize`).set(auth(USER_ROLES.OWNER)).send({})).status, 409);
    assert.equal((await request(app).post(`/api/v1/production/batches/${actualBatch._id}/cost/finalize`).set(auth(USER_ROLES.OWNER)).send({ expenses: [{ description: "Bad", amount: -1 }] })).status, 400);
  });
});
