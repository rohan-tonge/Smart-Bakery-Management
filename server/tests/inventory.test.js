process.env.NODE_ENV = "test";

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Ingredient from "../src/models/ingredient.model.js";
import Vendor from "../src/models/vendor.model.js";
import Purchase from "../src/models/purchase.model.js";
import InventoryLot from "../src/models/inventoryLot.model.js";
import InventoryTransaction from "../src/models/inventoryTransaction.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";
import inventoryService from "../src/services/inventory.service.js";

test("Phase 5: vendors, purchases, and auditable inventory", async (t) => {
  await connectToDb();
  await InventoryLot.deleteMany({});
  await InventoryTransaction.deleteMany({});
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = {};
  for (const role of [USER_ROLES.OWNER, USER_ROLES.MANAGER, USER_ROLES.PRODUCTION_STAFF, USER_ROLES.CUSTOMER]) {
    const user = await User.create({ name: `Phase 5 ${role}`, email: `${role.toLowerCase()}-${suffix}@inventory-test.com`, password: "Password123!", role });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });
  const flour = await Ingredient.create({ name: `Flour ${suffix}`, slug: `flour-${suffix}`, unit: "g", minimumStock: 1000, reorderLevel: 5000 });
  const sugar = await Ingredient.create({ name: `Sugar ${suffix}`, slug: `sugar-${suffix}`, unit: "g", minimumStock: 200, reorderLevel: 1000 });
  const cocoa = await Ingredient.create({ name: `Cocoa ${suffix}`, slug: `cocoa-${suffix}`, unit: "g", minimumStock: 100, reorderLevel: 500 });
  let vendor;
  const purchaseIds = [];

  t.after(async () => {
    const purchases = await Purchase.find({ _id: { $in: purchaseIds } }).select("_id");
    const ids = purchases.map((item) => item._id);
    await InventoryTransaction.deleteMany({ $or: [{ referenceId: { $in: [...ids] } }, { ingredient: { $in: [flour._id, sugar._id, cocoa._id] } }] });
    await InventoryLot.deleteMany({ ingredient: { $in: [flour._id, sugar._id, cocoa._id] } });
    await Purchase.deleteMany({ _id: { $in: purchaseIds } });
    if (vendor) await Vendor.deleteOne({ _id: vendor._id });
    await Ingredient.deleteMany({ _id: { $in: [flour._id, sugar._id, cocoa._id] } });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@inventory-test\\.com$`) });
    await disconnectDb();
  });

  await t.test("vendor CRUD is restricted to owner and manager", async () => {
    const customerDenied = await request(app).post("/api/v1/vendors").set(auth(USER_ROLES.CUSTOMER)).send({ name: "No vendor" });
    assert.equal(customerDenied.status, 403);
    const staffDenied = await request(app).get("/api/v1/vendors").set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(staffDenied.status, 403);
    const created = await request(app).post("/api/v1/vendors").set(auth(USER_ROLES.OWNER)).send({
      name: `ABC Foods ${suffix}`, contactPerson: "A. Supplier", phone: "+91 9876543210", email: `vendor-${suffix}@example.com`, address: "Bakery Road",
    });
    assert.equal(created.status, 201);
    vendor = created.body.data.vendor;
    const managerVendor = await request(app).post("/api/v1/vendors").set(auth(USER_ROLES.MANAGER)).send({ name: `Second Vendor ${suffix}` });
    assert.equal(managerVendor.status, 201);
    await Vendor.deleteOne({ _id: managerVendor.body.data.vendor._id });
    const duplicate = await request(app).post("/api/v1/vendors").set(auth(USER_ROLES.MANAGER)).send({ name: `abc foods ${suffix}` });
    assert.equal(duplicate.status, 409);
    const list = await request(app).get(`/api/v1/vendors?search=${suffix}&page=1&limit=1`).set(auth(USER_ROLES.MANAGER));
    assert.equal(list.status, 200);
    assert.equal(list.body.data.vendors.length, 1);
    assert.ok(list.body.meta.total >= 1);
    const detail = await request(app).get(`/api/v1/vendors/${vendor._id}`).set(auth(USER_ROLES.OWNER));
    assert.equal(detail.status, 200);
    const update = await request(app).patch(`/api/v1/vendors/${vendor._id}`).set(auth(USER_ROLES.MANAGER)).send({ notes: "Preferred supplier" });
    assert.equal(update.status, 200);
  });

  let firstPurchase;
  let secondPurchase;
  let cocoaPurchase;
  await t.test("purchases preserve item pricing and atomically create lots and transactions", async () => {
    const invalidVendor = await request(app).post("/api/v1/purchases").set(auth(USER_ROLES.OWNER)).send({ vendor: "000000000000000000000000", purchaseDate: new Date().toISOString(), items: [{ ingredient: flour._id, quantity: 1, unit: "kg", unitPrice: 50, lotNumber: "X" }] });
    assert.equal(invalidVendor.status, 400);
    const invalidIngredient = await request(app).post("/api/v1/purchases").set(auth(USER_ROLES.OWNER)).send({ vendor: vendor._id, purchaseDate: new Date().toISOString(), items: [{ ingredient: "000000000000000000000000", quantity: 1, unit: "kg", unitPrice: 50, lotNumber: "X" }] });
    assert.equal(invalidIngredient.status, 400);
    const invalidQuantity = await request(app).post("/api/v1/purchases").set(auth(USER_ROLES.OWNER)).send({ vendor: vendor._id, purchaseDate: new Date().toISOString(), items: [{ ingredient: flour._id, quantity: 0, unit: "kg", unitPrice: 50, lotNumber: "X" }] });
    assert.equal(invalidQuantity.status, 400);
    const invalidUnit = await request(app).post("/api/v1/purchases").set(auth(USER_ROLES.OWNER)).send({ vendor: vendor._id, purchaseDate: new Date().toISOString(), items: [{ ingredient: flour._id, quantity: 1, unit: "ml", unitPrice: 50, lotNumber: "X" }] });
    assert.equal(invalidUnit.status, 400);
    const customerDenied = await request(app).post("/api/v1/purchases").set(auth(USER_ROLES.CUSTOMER)).send({});
    assert.equal(customerDenied.status, 403);

    const purchaseDate = new Date();
    const first = await request(app).post("/api/v1/purchases").set(auth(USER_ROLES.OWNER)).send({
      vendor: vendor._id, purchaseDate, invoiceNumber: `INV-A-${suffix}`, tax: 5,
      items: [{ ingredient: flour._id, quantity: 10, unit: "kg", unitPrice: 50, lotNumber: "FLOUR-A", expiryDate: new Date(Date.now() + 5 * 86400000) }],
    });
    assert.equal(first.status, 201);
    firstPurchase = first.body.data.purchase;
    purchaseIds.push(firstPurchase._id);
    assert.equal(firstPurchase.subtotal, 500);
    assert.equal(firstPurchase.totalAmount, 505);
    const unitLocked = await request(app).patch(`/api/v1/ingredients/${flour._id}`).set(auth(USER_ROLES.MANAGER)).send({ unit: "ml" });
    assert.equal(unitLocked.status, 400);

    const second = await request(app).post("/api/v1/purchases").set(auth(USER_ROLES.MANAGER)).send({
      vendor: vendor._id, purchaseDate: new Date(Date.now() + 1000), invoiceNumber: `INV-B-${suffix}`,
      items: [{ ingredient: flour._id, quantity: 20, unit: "kg", unitPrice: 60, lotNumber: "FLOUR-B", expiryDate: new Date(Date.now() + 30 * 86400000) }],
    });
    assert.equal(second.status, 201);
    secondPurchase = second.body.data.purchase;
    purchaseIds.push(secondPurchase._id);

    const cocoaRes = await request(app).post("/api/v1/purchases").set(auth(USER_ROLES.OWNER)).send({
      vendor: vendor._id, purchaseDate: new Date(), invoiceNumber: `INV-C-${suffix}`,
      items: [{ ingredient: cocoa._id, quantity: 2, unit: "kg", unitPrice: 35, lotNumber: "COCOA-EXPIRING", expiryDate: new Date(Date.now() + 3 * 86400000) }],
    });
    assert.equal(cocoaRes.status, 201);
    cocoaPurchase = cocoaRes.body.data.purchase;
    purchaseIds.push(cocoaPurchase._id);

    const lots = await InventoryLot.find({ purchase: { $in: [firstPurchase._id, secondPurchase._id] } }).sort({ unitCost: 1 });
    assert.equal(lots.length, 2);
    assert.deepEqual(lots.map((lot) => lot.unitCost), [50, 60]);
    assert.deepEqual(lots.map((lot) => lot.unit), ["kg", "kg"]);
    assert.equal(await InventoryTransaction.countDocuments({ referenceType: "PURCHASE", referenceId: firstPurchase._id }), 1);
    const stock = await request(app).get(`/api/v1/inventory/${flour._id}`).set(auth(USER_ROLES.OWNER));
    assert.equal(stock.status, 200);
    assert.equal(stock.body.data.currentStock, 30000);
    assert.equal(stock.body.data.unit, "g");
    const purchaseList = await request(app).get(`/api/v1/purchases?vendor=${vendor._id}&ingredient=${flour._id}`).set(auth(USER_ROLES.MANAGER));
    assert.equal(purchaseList.body.meta.total, 2);
    const purchaseDetail = await request(app).get(`/api/v1/purchases/${firstPurchase._id}`).set(auth(USER_ROLES.OWNER));
    assert.equal(purchaseDetail.status, 200);

    const originalRecordPurchaseStock = inventoryService.recordPurchaseStock;
    inventoryService.recordPurchaseStock = async function (purchase, session) {
      await originalRecordPurchaseStock.call(this, purchase, session);
      throw new Error("simulated failure after inventory writes");
    };
    try {
      const failed = await request(app).post("/api/v1/purchases").set(auth(USER_ROLES.OWNER)).send({
        vendor: vendor._id, purchaseDate: new Date(), invoiceNumber: `INV-ROLLBACK-${suffix}`,
        items: [{ ingredient: sugar._id, quantity: 1, unit: "kg", unitPrice: 10, lotNumber: "ROLLBACK-LOT" }],
      });
      assert.equal(failed.status, 500);
    } finally {
      inventoryService.recordPurchaseStock = originalRecordPurchaseStock;
    }
    assert.equal(await Purchase.countDocuments({ invoiceNumber: `INV-ROLLBACK-${suffix}` }), 0);
    assert.equal(await InventoryLot.countDocuments({ lotNumber: "ROLLBACK-LOT" }), 0);
    assert.equal(await InventoryTransaction.countDocuments({ ingredient: sugar._id }), 0);
  });

  await t.test("inventory adjustments, low stock, expiry, FEFO, valuation, and transaction audit", async () => {
    const customerDenied = await request(app).get("/api/v1/inventory").set(auth(USER_ROLES.CUSTOMER));
    assert.equal(customerDenied.status, 403);
    const add = await request(app).post("/api/v1/inventory/adjustments").set(auth(USER_ROLES.MANAGER)).send({ ingredientId: flour._id, quantity: 500, unit: "g", type: "ADD", reason: "Count correction" });
    assert.equal(add.status, 200);
    assert.equal(add.body.data.currentStock, 30500);
    const badUnit = await request(app).post("/api/v1/inventory/adjustments").set(auth(USER_ROLES.OWNER)).send({ ingredientId: flour._id, quantity: 1, unit: "ml", type: "ADD", reason: "Invalid unit" });
    assert.equal(badUnit.status, 400);
    const insufficient = await request(app).post("/api/v1/inventory/adjustments").set(auth(USER_ROLES.OWNER)).send({ ingredientId: flour._id, quantity: 40000, unit: "g", type: "REMOVE", reason: "Overdraw attempt" });
    assert.equal(insufficient.status, 400);

    const value = await request(app).get("/api/v1/inventory/value").set(auth(USER_ROLES.OWNER));
    assert.equal(value.status, 200);
    assert.equal(value.body.data.value, 1770);

    const expiringBefore = await request(app).get("/api/v1/inventory/expiring?days=7").set(auth(USER_ROLES.MANAGER));
    assert.equal(expiringBefore.status, 200);
    assert.ok(expiringBefore.body.data.lots.some((lot) => lot.lotNumber === "FLOUR-A"));
    assert.ok(expiringBefore.body.data.lots.some((lot) => lot.lotNumber === "COCOA-EXPIRING"));

    const lowStock = await request(app).get("/api/v1/inventory/low-stock?limit=250").set(auth(USER_ROLES.OWNER));
    assert.equal(lowStock.status, 200);
    assert.ok(lowStock.body.data.ingredients.some((item) => item._id === sugar._id.toString()));
    assert.ok(!lowStock.body.data.ingredients.some((item) => item._id === flour._id.toString()));

    const remove = await request(app).post("/api/v1/inventory/adjustments").set(auth(USER_ROLES.OWNER)).send({ ingredientId: flour._id, quantity: 10, unit: "kg", type: "REMOVE", reason: "Physical count correction" });
    assert.equal(remove.status, 200);
    assert.equal(remove.body.data.currentStock, 20500);
    const firstLot = await InventoryLot.findOne({ purchase: firstPurchase._id });
    assert.equal(firstLot.remainingQuantity, 0);
    assert.equal(firstLot.status, "DEPLETED");
    assert.equal(firstLot.unitCost, 50);
    const expiringAfter = await request(app).get("/api/v1/inventory/expiring?days=7").set(auth(USER_ROLES.MANAGER));
    assert.ok(!expiringAfter.body.data.lots.some((lot) => lot.lotNumber === "FLOUR-A"));

    const transactions = await request(app).get(`/api/v1/inventory/transactions/${flour._id}?limit=20`).set(auth(USER_ROLES.MANAGER));
    assert.equal(transactions.status, 200);
    assert.equal(transactions.body.meta.total, 4);
    assert.ok(transactions.body.data.transactions.some((item) => item.type === "ADJUSTMENT" && item.direction === "OUT"));
    assert.ok(transactions.body.data.transactions.some((item) => item.type === "ADJUSTMENT" && item.direction === "IN"));
    const allTransactions = await request(app).get(`/api/v1/inventory/transactions?ingredient=${flour._id}&type=ADJUSTMENT&limit=20`).set(auth(USER_ROLES.OWNER));
    assert.equal(allTransactions.status, 200);
    assert.equal(allTransactions.body.meta.total, 2);
    assert.ok(allTransactions.body.data.transactions.every((item) => item.type === "ADJUSTMENT"));
    assert.equal((await request(app).get("/api/v1/inventory/transactions").set(auth(USER_ROLES.CUSTOMER))).status, 403);
    assert.equal((await request(app).get("/api/v1/inventory/transactions?from=2030-01-02&to=2030-01-01").set(auth(USER_ROLES.MANAGER))).status, 400);
    const listing = await request(app).get("/api/v1/inventory?page=1&limit=2").set(auth(USER_ROLES.OWNER));
    assert.equal(listing.status, 200);
    assert.equal(listing.body.data.inventory.length, 2);
  });

  await t.test("deactivated vendors cannot be used for future purchases", async () => {
    const deactivated = await request(app).delete(`/api/v1/vendors/${vendor._id}`).set(auth(USER_ROLES.OWNER));
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.data.vendor.isActive, false);
    const purchase = await request(app).post("/api/v1/purchases").set(auth(USER_ROLES.MANAGER)).send({
      vendor: vendor._id, purchaseDate: new Date(), items: [{ ingredient: flour._id, quantity: 1, unit: "kg", unitPrice: 1, lotNumber: "INACTIVE-VENDOR" }],
    });
    assert.equal(purchase.status, 400);
  });

  await t.test("low-stock alert and threshold consistency for ingredient with stock between minimumStock and reorderLevel", async () => {
    const testVanilla = await Ingredient.create({
      name: `Vanilla Essence ${suffix}`,
      slug: `vanilla-essence-${suffix}`,
      unit: "kg",
      minimumStock: 1,
      reorderLevel: 5,
    });

    try {
      const adjustRes = await request(app)
        .post("/api/v1/inventory/adjustments")
        .set(auth(USER_ROLES.OWNER))
        .send({
          ingredientId: testVanilla._id,
          quantity: 2.1,
          unit: "kg",
          type: "ADD",
          reason: "Stock calibration between min and reorder",
        });
      assert.equal(adjustRes.status, 200);
      assert.equal(adjustRes.body.data.currentStock, 2.1);

      const invListRes = await request(app)
        .get("/api/v1/inventory?limit=250")
        .set(auth(USER_ROLES.OWNER));
      assert.equal(invListRes.status, 200);
      const invItem = invListRes.body.data.inventory.find(
        (i) => i._id === testVanilla._id.toString()
      );
      assert.ok(invItem, "Vanilla Essence should be present in inventory list");
      assert.equal(invItem.currentStock, 2.1);
      assert.equal(invItem.minimumStock, 1);
      assert.equal(invItem.reorderLevel, 5);
      assert.equal(invItem.lowStockThreshold, 5);

      const lowStockRes = await request(app)
        .get("/api/v1/inventory/low-stock?limit=250")
        .set(auth(USER_ROLES.OWNER));
      assert.equal(lowStockRes.status, 200);
      const lowItem = lowStockRes.body.data.ingredients.find(
        (i) => i._id === testVanilla._id.toString()
      );
      assert.ok(
        lowItem,
        "Ingredient whose stock is below reorderLevel but above minimumStock must trigger low-stock alert"
      );
      assert.equal(lowItem.currentStock, 2.1);
      assert.equal(lowItem.lowStockThreshold, 5);

      const replenishRes = await request(app)
        .post("/api/v1/inventory/adjustments")
        .set(auth(USER_ROLES.OWNER))
        .send({
          ingredientId: testVanilla._id,
          quantity: 3,
          unit: "kg",
          type: "ADD",
          reason: "Replenish above reorderLevel",
        });
      assert.equal(replenishRes.status, 200);
      assert.equal(replenishRes.body.data.currentStock, 5.1);

      const clearedLowStockRes = await request(app)
        .get("/api/v1/inventory/low-stock")
        .set(auth(USER_ROLES.OWNER));
      assert.equal(clearedLowStockRes.status, 200);
      const clearedItem = clearedLowStockRes.body.data.ingredients.find(
        (i) => i._id === testVanilla._id.toString()
      );
      assert.equal(clearedItem, undefined, "Replenished ingredient should no longer be in low stock");
    } finally {
      await InventoryTransaction.deleteMany({ ingredient: testVanilla._id });
      await InventoryLot.deleteMany({ ingredient: testVanilla._id });
      await Ingredient.deleteOne({ _id: testVanilla._id });
    }
  });

  await t.test("changing an ingredient reorder level dynamically updates low-stock alert status", async () => {
    const ingredient = await Ingredient.create({
      name: `Vanilla Extract Test ${suffix}`,
      slug: `vanilla-extract-test-${suffix}`,
      unit: "kg",
      minimumStock: 0,
      reorderLevel: 12,
    });

    try {
      const adjustRes = await request(app)
        .post("/api/v1/inventory/adjustments")
        .set(auth(USER_ROLES.OWNER))
        .send({
          ingredientId: ingredient._id,
          quantity: 2.1,
          unit: "kg",
          type: "ADD",
          reason: "Initial stock for reorder level test",
        });
      assert.equal(adjustRes.status, 200);
      assert.equal(adjustRes.body.data.currentStock, 2.1);

      const initialLowStock = await request(app)
        .get("/api/v1/inventory/low-stock?limit=250")
        .set(auth(USER_ROLES.OWNER));
      assert.equal(initialLowStock.status, 200);
      const flaggedItem = initialLowStock.body.data.ingredients.find(
        (i) => i._id === ingredient._id.toString()
      );
      assert.ok(flaggedItem, "Ingredient with stock 2.1 and reorderLevel 12 must appear in low-stock alerts");
      assert.equal(flaggedItem.lowStockThreshold, 12);
      assert.equal(flaggedItem.reorderLevel, 12);

      const updateRes = await request(app)
        .patch(`/api/v1/ingredients/${ingredient._id}`)
        .set(auth(USER_ROLES.MANAGER))
        .send({ reorderLevel: 1 });
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.body.data.ingredient.reorderLevel, 1);

      const updatedLowStock = await request(app)
        .get("/api/v1/inventory/low-stock?limit=250")
        .set(auth(USER_ROLES.OWNER));
      assert.equal(updatedLowStock.status, 200);
      const clearedItem = updatedLowStock.body.data.ingredients.find(
        (i) => i._id === ingredient._id.toString()
      );
      assert.equal(
        clearedItem,
        undefined,
        "Ingredient whose reorder level was reduced below current stock must no longer appear in low stock"
      );

      const invRes = await request(app)
        .get(`/api/v1/inventory?limit=250`)
        .set(auth(USER_ROLES.OWNER));
      assert.equal(invRes.status, 200);
      const invItem = invRes.body.data.inventory.find(
        (i) => i._id === ingredient._id.toString()
      );
      assert.ok(invItem);
      assert.equal(invItem.reorderLevel, 1);
      assert.equal(invItem.lowStockThreshold, 1);
      assert.equal(invItem.currentStock, 2.1);
    } finally {
      await InventoryTransaction.deleteMany({ ingredient: ingredient._id });
      await InventoryLot.deleteMany({ ingredient: ingredient._id });
      await Ingredient.deleteOne({ _id: ingredient._id });
    }
  });
});


