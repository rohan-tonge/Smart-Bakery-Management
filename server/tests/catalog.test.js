process.env.NODE_ENV = "test";

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import Order from "../src/models/order.model.js";
import { generateAccessToken } from "../src/utils/token.utils.js";
import { USER_ROLES } from "../src/utils/constants.js";

test("Phase 3: categories, products, and variants", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const emailFor = (role) => `${role.toLowerCase()}-${suffix}@catalog-test.com`;
  const users = {};
  for (const role of Object.values(USER_ROLES)) {
    const user = await User.create({ name: `Catalog ${role}`, email: emailFor(role), password: "Password123!", role });
    users[role] = { user, token: generateAccessToken(user) };
  }
  const auth = (role) => ({ Authorization: `Bearer ${users[role].token}` });
  let categoryId;
  let productId;
  let managerProductId;
  let variantId;

  t.after(async () => {
    await Product.deleteMany({ name: new RegExp(suffix) });
    await Category.deleteMany({ name: new RegExp(suffix) });
    await User.deleteMany({ email: new RegExp(`${suffix}\\@catalog-test\\.com$`) });
    await disconnectDb();
  });

  await t.test("category permissions, uniqueness, listing, update, and soft deletion", async () => {
    const denied = await request(app).post("/api/v1/categories").set(auth(USER_ROLES.CUSTOMER)).send({ name: `Nope ${suffix}` });
    assert.equal(denied.status, 403);
    const managerCreate = await request(app).post("/api/v1/categories").set(auth(USER_ROLES.MANAGER)).send({ name: `Pastry ${suffix}`, sortOrder: 2 });
    assert.equal(managerCreate.status, 201);
    const category = managerCreate.body.data.category;
    categoryId = category._id;
    assert.equal(category.slug, `pastry-${suffix}`.toLowerCase());
    const ownerCreate = await request(app).post("/api/v1/categories").set(auth(USER_ROLES.OWNER)).send({ name: `Bread ${suffix}` });
    assert.equal(ownerCreate.status, 201);
    const duplicate = await request(app).post("/api/v1/categories").set(auth(USER_ROLES.OWNER)).send({ name: `Pastry ${suffix}` });
    assert.equal(duplicate.status, 409);
    const list = await request(app).get("/api/v1/categories").set(auth(USER_ROLES.CUSTOMER));
    assert.equal(list.status, 200);
    assert.ok(list.body.data.categories.some((item) => item._id === categoryId));
    const detail = await request(app).get(`/api/v1/categories/${categoryId}`).set(auth(USER_ROLES.CUSTOMER));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.category._id, categoryId);
    assert.equal((await request(app).get("/api/v1/categories/not-an-id")).status, 400);
    assert.equal((await request(app).get(`/api/v1/categories/${"a".repeat(24)}`)).status, 404);
    const updateDenied = await request(app).patch(`/api/v1/categories/${categoryId}`).set(auth(USER_ROLES.CUSTOMER)).send({ description: "x" });
    assert.equal(updateDenied.status, 403);
    const update = await request(app).patch(`/api/v1/categories/${categoryId}`).set(auth(USER_ROLES.OWNER)).send({ description: "Fresh pastries" });
    assert.equal(update.status, 200);
    const deleteDenied = await request(app).delete(`/api/v1/categories/${categoryId}`).set(auth(USER_ROLES.MANAGER));
    assert.equal(deleteDenied.status, 403);
  });

  await t.test("product CRUD, filtering, visibility, and pagination", async () => {
    const invalid = await request(app).post("/api/v1/products").set(auth(USER_ROLES.OWNER)).send({ name: "Cake", category: "000000000000000000000000" });
    assert.equal(invalid.status, 400);
    const denied = await request(app).post("/api/v1/products").set(auth(USER_ROLES.CUSTOMER)).send({});
    assert.equal(denied.status, 403);
    const created = await request(app).post("/api/v1/products").set(auth(USER_ROLES.OWNER)).send({ name: `Chocolate Cake ${suffix}`, category: categoryId, basePrice: 550, tags: ["chocolate"] });
    assert.equal(created.status, 201);
    productId = created.body.data.product._id;
    const second = await request(app).post("/api/v1/products").set(auth(USER_ROLES.MANAGER)).send({ name: `Brownie ${suffix}`, category: categoryId, basePrice: 100, isAvailable: false });
    assert.equal(second.status, 201);
    managerProductId = second.body.data.product._id;
    const managerList = await request(app).get(`/api/v1/products?search=chocolate&category=${categoryId}&minPrice=500&page=1&limit=1`).set(auth(USER_ROLES.MANAGER));
    assert.equal(managerList.status, 200);
    assert.equal(managerList.body.data.products.length, 1);
    assert.equal(managerList.body.meta.limit, 1);
    assert.equal(managerList.body.meta.total, 1);
    const customerList = await request(app).get(`/api/v1/products?category=${categoryId}`).set(auth(USER_ROLES.CUSTOMER));
    assert.equal(customerList.status, 200);
    assert.equal(customerList.body.data.products.length, 1);
    const customerSingle = await request(app).get(`/api/v1/products/${productId}`).set(auth(USER_ROLES.CUSTOMER));
    assert.equal(customerSingle.status, 200);
    const updateDenied = await request(app).patch(`/api/v1/products/${productId}`).set(auth(USER_ROLES.CUSTOMER)).send({ basePrice: 600 });
    assert.equal(updateDenied.status, 403);
    const updated = await request(app).patch(`/api/v1/products/${productId}`).set(auth(USER_ROLES.MANAGER)).send({ basePrice: 600 });
    assert.equal(updated.status, 200);
  });

  await t.test("variant CRUD, duplicate checks, and customer visibility", async () => {
    const invalidProduct = await request(app).post("/api/v1/products/not-an-id/variants").set(auth(USER_ROLES.OWNER)).send({ name: "1kg", quantity: 1, unit: "kg", price: 550 });
    assert.equal(invalidProduct.status, 400);
    const payload = { name: "1kg", quantity: 1, unit: "kg", price: 550 };
    const created = await request(app).post(`/api/v1/products/${productId}/variants`).set(auth(USER_ROLES.MANAGER)).send(payload);
    assert.equal(created.status, 201);
    variantId = created.body.data.variant._id;
    const duplicate = await request(app).post(`/api/v1/products/${productId}/variants`).set(auth(USER_ROLES.OWNER)).send(payload);
    assert.equal(duplicate.status, 409);
    const customerRead = await request(app).get(`/api/v1/products/${productId}/variants`).set(auth(USER_ROLES.CUSTOMER));
    assert.equal(customerRead.status, 200);
    assert.equal(customerRead.body.data.variants.length, 1);
    const customerManage = await request(app).patch(`/api/v1/products/${productId}/variants/${variantId}`).set(auth(USER_ROLES.CUSTOMER)).send({ price: 500 });
    assert.equal(customerManage.status, 403);
    const variantPriceSearch = await request(app).get("/api/v1/products?minPrice=500&maxPrice=575").set(auth(USER_ROLES.MANAGER));
    assert.ok(variantPriceSearch.body.data.products.some((item) => item._id === productId));
    const updated = await request(app).patch(`/api/v1/products/${productId}/variants/${variantId}`).set(auth(USER_ROLES.OWNER)).send({ price: 500 });
    assert.equal(updated.status, 200);
    const deleted = await request(app).delete(`/api/v1/products/${productId}/variants/${variantId}`).set(auth(USER_ROLES.MANAGER));
    assert.equal(deleted.status, 200);
    const hidden = await request(app).get(`/api/v1/products/${productId}/variants/${variantId}`).set(auth(USER_ROLES.CUSTOMER));
    assert.equal(hidden.status, 404);
  });

  await t.test("product deletion is authorized, repeatable, hidden from catalogs, and preserves order history", async () => {
    const staffDenied = await request(app).delete(`/api/v1/products/${productId}`).set(auth(USER_ROLES.PRODUCTION_STAFF));
    assert.equal(staffDenied.status, 403);
    const customerDenied = await request(app).delete(`/api/v1/products/${productId}`).set(auth(USER_ROLES.CUSTOMER));
    assert.equal(customerDenied.status, 403);

    const order = await Order.create({
      orderNumber: `ORD-DELETE-${Date.now()}`,
      items: [{ productId, variantId, productName: `Chocolate Cake ${suffix}`, variantName: "1kg", quantity: 1, unitPrice: 600, lineTotal: 600 }],
      subtotal: 600, total: 600, orderType: "PICKUP", paymentMethod: "MANUAL_UPI",
      contactPhone: "9876543210", status: "COMPLETED",
    });
    const deleted = await request(app).delete(`/api/v1/products/${productId}`).set(auth(USER_ROLES.OWNER));
    assert.equal(deleted.status, 200, deleted.body.message);
    assert.equal(deleted.body.data.product.isActive, false);
    const repeated = await request(app).delete(`/api/v1/products/${productId}`).set(auth(USER_ROLES.OWNER));
    assert.equal(repeated.status, 200, repeated.body.message);
    const missing = await request(app).delete("/api/v1/products/000000000000000000000000").set(auth(USER_ROLES.OWNER));
    assert.equal(missing.status, 404);
    const hidden = await request(app).get("/api/v1/products").set(auth(USER_ROLES.CUSTOMER));
    assert.equal(hidden.status, 200);
    assert.ok(!hidden.body.data.products.some((item) => item._id === productId));
    const historicalOrder = await Order.findById(order._id);
    assert.equal(historicalOrder.items[0].productName, `Chocolate Cake ${suffix}`);
    await Order.deleteOne({ _id: order._id });
  });

  await t.test("category deletion soft-deactivates dependent products", async () => {
    const productDeleted = await request(app).delete(`/api/v1/products/${managerProductId}`).set(auth(USER_ROLES.MANAGER));
    assert.equal(productDeleted.status, 200);
    assert.equal(productDeleted.body.data.product.isActive, false);
    const deleted = await request(app).delete(`/api/v1/categories/${categoryId}`).set(auth(USER_ROLES.OWNER));
    assert.equal(deleted.status, 200);
    const product = await Product.findById(productId);
    assert.equal(product.isActive, false);
    const hidden = await request(app).get(`/api/v1/products/${productId}`).set(auth(USER_ROLES.CUSTOMER));
    assert.equal(hidden.status, 404);
  });
});
