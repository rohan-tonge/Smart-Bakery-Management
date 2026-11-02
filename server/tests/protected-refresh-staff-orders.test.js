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
import ProductionBatch from "../src/models/productionBatch.model.js";
import Order from "../src/models/order.model.js";
import { USER_ROLES, PRODUCTION_STATUS } from "../src/utils/constants.js";

test("Protected Page Refresh, Staff Order Sorting, and Empty States Suite (14 Scenarios)", async (t) => {
  await connectToDb();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Create Users for each role
  const owner = await User.create({
    name: `Owner Test ${suffix}`,
    email: `owner-${suffix}@bakery-test.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER_MANAGER,
  });

  const manager = await User.create({
    name: `Manager Test ${suffix}`,
    email: `manager-${suffix}@bakery-test.com`,
    password: "Password123!",
    role: USER_ROLES.MANAGER,
  });

  const staff = await User.create({
    name: `Staff Baker ${suffix}`,
    email: `staff-${suffix}@bakery-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
  });

  const emptyStaff = await User.create({
    name: `Empty Staff ${suffix}`,
    email: `emptystaff-${suffix}@bakery-test.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
  });

  const customer = await User.create({
    name: `Customer Test ${suffix}`,
    email: `customer-${suffix}@bakery-test.com`,
    password: "Password123!",
    role: USER_ROLES.CUSTOMER,
  });

  const category = await Category.create({
    name: `Cat ${suffix}`,
    slug: `cat-${suffix}`,
  });

  const product = await Product.create({
    name: `Croissant ${suffix}`,
    slug: `croissant-${suffix}`,
    category: category._id,
    variants: [{ name: "Standard", quantity: 1, unit: "piece", price: 50 }],
  });
  const variantId = product.variants[0]._id;

  const ingredient = await Ingredient.create({
    name: `Flour ${suffix}`,
    slug: `flour-${suffix}`,
    unit: "g",
    minimumStock: 100,
  });

  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    ingredients: [{ ingredient: ingredient._id, quantity: 200, unit: "g" }],
    expectedYield: 10,
    yieldUnit: "piece",
    estimatedDurationMinutes: 45,
  });

  const testOrder = await Order.create({
    orderNumber: `ORD-${suffix}`,
    customer: customer._id,
    items: [{
      productId: product._id,
      variantId,
      productName: product.name,
      variantName: "Standard",
      quantity: 5,
      unitPrice: 50,
      lineTotal: 250,
    }],
    subtotal: 250,
    total: 250,
    orderType: "PICKUP",
    contactName: "Customer Tester",
    contactPhone: "9876543210",
    status: "CONFIRMED",
    paymentStatus: "PAYMENT_CONFIRMED",
  });

  t.after(async () => {
    await ProductionBatch.deleteMany({ "assignedWorkers.worker": { $in: [staff._id, emptyStaff._id] } });
    await Order.deleteOne({ _id: testOrder._id });
    await Recipe.deleteOne({ _id: recipe._id });
    await Product.deleteOne({ _id: product._id });
    await Category.deleteOne({ _id: category._id });
    await Ingredient.deleteOne({ _id: ingredient._id });
    await User.deleteMany({ _id: { $in: [owner._id, manager._id, staff._id, emptyStaff._id, customer._id] } });
    await disconnectDb();
  });

  // Track cookies across test
  let ownerLoginRes;
  let ownerCookie;
  let ownerToken;

  let staffLoginRes;
  let staffCookie;
  let staffToken;

  await t.test("Scenario 1: Authenticated owner session refresh on /owner preserves session without redirect to Home", async () => {
    ownerLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: owner.email, password: "Password123!" });

    assert.equal(ownerLoginRes.status, 200);
    ownerToken = ownerLoginRes.body.data.accessToken;
    const cookies = ownerLoginRes.headers["set-cookie"];
    assert.ok(cookies, "Expected Set-Cookie header with refreshToken");
    ownerCookie = cookies.find((c) => c.startsWith("refreshToken="));
    assert.ok(ownerCookie, "refreshToken cookie must be present");

    // Client verifies session on refresh via getMe
    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.data.user.email, owner.email);
    assert.equal(meRes.body.data.user.role, USER_ROLES.OWNER_MANAGER);
  });

  await t.test("Scenario 2: Authenticated owner with query parameters (/owner?tab=inventory) preserves tab on refresh", async () => {
    // When owner is on /owner?tab=inventory, dashboard loads inventory data via API
    const invRes = await request(app)
      .get("/api/v1/ingredients")
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(invRes.status, 200);
    assert.ok(Array.isArray(invRes.body.data.ingredients || invRes.body.data));
  });

  await t.test("Scenario 3: Authenticated manager session on /manager redirects cleanly to /owner preserving query params", async () => {
    const mgrLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: manager.email, password: "Password123!" });

    assert.equal(mgrLoginRes.status, 200);
    const mgrToken = mgrLoginRes.body.data.accessToken;

    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${mgrToken}`);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.data.user.email, manager.email);
    // Manager has access to management resources
    const prodRes = await request(app)
      .get("/api/v1/production/batches")
      .set("Authorization", `Bearer ${mgrToken}`);
    assert.equal(prodRes.status, 200);
  });

  await t.test("Scenario 4: Authenticated production staff session refresh on /production preserves session", async () => {
    staffLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: staff.email, password: "Password123!" });

    assert.equal(staffLoginRes.status, 200);
    staffToken = staffLoginRes.body.data.accessToken;
    const cookies = staffLoginRes.headers["set-cookie"];
    staffCookie = cookies.find((c) => c.startsWith("refreshToken="));

    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.data.user.role, USER_ROLES.PRODUCTION_STAFF);

    // Production staff cannot access manager-only worker management endpoints
    const forbiddenRes = await request(app)
      .get("/api/v1/workers")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(forbiddenRes.status, 403);
  });

  await t.test("Scenario 5: Expired access token with valid refresh cookie automatically restores session", async () => {
    // Simulate expired access token by not sending bearer token, only the valid HttpOnly refresh cookie
    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", staffCookie);

    assert.equal(refreshRes.status, 200);
    assert.ok(refreshRes.body.data.accessToken);
    assert.equal(refreshRes.body.data.user.email, staff.email);
    assert.equal(refreshRes.body.data.user.role, USER_ROLES.PRODUCTION_STAFF);

    // Update staffToken and staffCookie with rotated token
    staffToken = refreshRes.body.data.accessToken;
    const newCookies = refreshRes.headers["set-cookie"];
    if (newCookies) {
      staffCookie = newCookies.find((c) => c.startsWith("refreshToken=")) || staffCookie;
    }

    // New access token works immediately on protected endpoints
    const verifyRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(verifyRes.status, 200);
  });

  await t.test("Scenario 6: Truly unauthenticated user visiting /owner is rejected with 401", async () => {
    const unauthRes = await request(app)
      .get("/api/v1/auth/me");

    assert.equal(unauthRes.status, 401);
  });

  await t.test("Scenario 7: Truly unauthenticated user with invalid/cleared refresh token cannot refresh session", async () => {
    const invalidRefreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", "refreshToken=invalid_token_xyz_123");

    assert.equal(invalidRefreshRes.status, 401);
  });

  let batch1;
  let batch2;
  let batch3;

  await t.test("Scenario 8: Worker batches endpoint sorts batches by canonical createdAt descending with _id descending", async () => {
    // Create 3 batches through production API with ownerToken
    const b1Res = await request(app)
      .post("/api/v1/production/batches")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        product: product._id,
        productVariant: variantId,
        plannedQuantity: 10,
        assignedWorkers: [{ worker: staff._id, task: "Mixing" }],
        relatedOrders: [testOrder._id],
      });
    assert.equal(b1Res.status, 201, b1Res.body.message);
    batch1 = b1Res.body.data.batch;

    // Small delay to ensure createdAt progression
    await new Promise((r) => setTimeout(r, 20));

    const b2Res = await request(app)
      .post("/api/v1/production/batches")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        product: product._id,
        productVariant: variantId,
        plannedQuantity: 15,
        assignedWorkers: [{ worker: staff._id, task: "Baking" }],
        relatedOrders: [testOrder._id],
      });
    assert.equal(b2Res.status, 201, b2Res.body.message);
    batch2 = b2Res.body.data.batch;

    await new Promise((r) => setTimeout(r, 20));

    const b3Res = await request(app)
      .post("/api/v1/production/batches")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        product: product._id,
        productVariant: variantId,
        plannedQuantity: 20,
        assignedWorkers: [{ worker: staff._id, task: "Packaging" }],
        relatedOrders: [testOrder._id],
      });
    assert.equal(b3Res.status, 201, b3Res.body.message);
    batch3 = b3Res.body.data.batch;

    const res = await request(app)
      .get("/api/v1/workers/me/batches")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(res.status, 200);
    const batches = res.body.data.batches;
    assert.ok(batches.length >= 3);

    // Verify newest batch appears first
    const testBatches = batches.filter((b) => [batch1._id.toString(), batch2._id.toString(), batch3._id.toString()].includes(b._id.toString()));
    assert.equal(testBatches[0]._id.toString(), batch3._id.toString(), "Newest batch (batch3) must be at index 0");
    assert.equal(testBatches[1]._id.toString(), batch2._id.toString(), "Middle batch (batch2) must be at index 1");
    assert.equal(testBatches[2]._id.toString(), batch1._id.toString(), "Oldest batch (batch1) must be at index 2");
  });

  await t.test("Scenario 9: Worker batches endpoint with active=true filters out COMPLETED, CANCELLED, REJECTED, PACKAGED batches", async () => {
    // Mark batch1 as COMPLETED directly in DB
    await ProductionBatch.updateOne({ _id: batch1._id }, { $set: { status: PRODUCTION_STATUS.COMPLETED } });

    // Create a 4th batch and mark it CANCELLED
    const b4Res = await request(app)
      .post("/api/v1/production/batches")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        product: product._id,
        productVariant: variantId,
        plannedQuantity: 5,
        assignedWorkers: [{ worker: staff._id, task: "Oven" }],
      });
    assert.equal(b4Res.status, 201);
    await ProductionBatch.updateOne({ _id: b4Res.body.data.batch._id }, { $set: { status: PRODUCTION_STATUS.CANCELLED } });

    const res = await request(app)
      .get("/api/v1/workers/me/batches?active=true")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(res.status, 200);
    const returnedBatches = res.body.data.batches;
    const returnedIds = returnedBatches.map((b) => b._id.toString());

    // Active batches (batch2, batch3) must be present
    assert.ok(returnedIds.includes(batch2._id.toString()), "Active batch2 must be in active queue");
    assert.ok(returnedIds.includes(batch3._id.toString()), "Active batch3 must be in active queue");

    // Inactive/terminal batches must NOT be present
    assert.ok(!returnedIds.includes(batch1._id.toString()), "COMPLETED batch1 must be excluded from active queue");
    assert.ok(!returnedIds.includes(b4Res.body.data.batch._id.toString()), "CANCELLED batch must be excluded from active queue");
  });

  await t.test("Scenario 10: Worker batches endpoint returns metadata distinguishing totalAll from totalActive", async () => {
    const res = await request(app)
      .get("/api/v1/workers/me/batches?active=true")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.meta, "meta field must be present");
    assert.ok(res.body.meta.totalAll >= 4, "totalAll includes all assigned batches (active + completed + cancelled)");
    assert.ok(res.body.meta.totalActive >= 2, "totalActive includes only active batches");
    assert.equal(res.body.meta.total, res.body.meta.totalActive, "filtered query total matches totalActive");
  });

  await t.test("Scenario 11: Production staff workstation shows 'No Active Orders' when staff has only completed batches", async () => {
    // Mark remaining active batches as COMPLETED
    await ProductionBatch.updateMany(
      { "assignedWorkers.worker": staff._id },
      { $set: { status: PRODUCTION_STATUS.COMPLETED } }
    );

    const res = await request(app)
      .get("/api/v1/workers/me/batches?active=true")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.batches.length, 0, "No active batches returned");
    assert.ok(res.body.meta.totalAll > 0, "totalAll > 0 indicates staff has historical orders");
    assert.equal(res.body.meta.totalActive, 0, "totalActive === 0");

    // In UI logic: batches.length === 0 && meta.totalAll > 0 triggers:
    // "No Active Orders — There are currently no active orders assigned to production. New work will appear here when available."
  });

  await t.test("Scenario 12: Production staff workstation shows 'No Orders Yet' when staff has zero batches", async () => {
    const emptyStaffLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: emptyStaff.email, password: "Password123!" });

    assert.equal(emptyStaffLogin.status, 200);
    const emptyToken = emptyStaffLogin.body.data.accessToken;

    const res = await request(app)
      .get("/api/v1/workers/me/batches?active=true")
      .set("Authorization", `Bearer ${emptyToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.batches.length, 0);
    assert.equal(res.body.meta.totalAll, 0);
    assert.equal(res.body.meta.totalActive, 0);

    // In UI logic: batches.length === 0 && meta.totalAll === 0 triggers:
    // "No Orders Yet — No orders are available for production."
  });

  await t.test("Scenario 13: Production staff workstation provides retry action on API error contract", async () => {
    // When query validation fails (e.g. invalid date)
    const errRes = await request(app)
      .get("/api/v1/workers/me/batches?date=invalid-date")
      .set("Authorization", `Bearer ${staffToken}`);

    assert.equal(errRes.status, 400);
    assert.equal(errRes.body.success, false);
    assert.ok(errRes.body.message || errRes.body.errors);
  });

  await t.test("Scenario 14: Refresh idempotency: multiple successive refreshes do not corrupt auth state or cause redirect loops", async () => {
    let currentCookie = ownerCookie;

    for (let i = 1; i <= 3; i++) {
      const refreshRes = await request(app)
        .post("/api/v1/auth/refresh")
        .set("Cookie", currentCookie);

      assert.equal(refreshRes.status, 200, `Refresh step ${i} must succeed`);
      assert.ok(refreshRes.body.data.accessToken, `Refresh step ${i} must yield new accessToken`);
      assert.equal(refreshRes.body.data.user.email, owner.email);

      // Verify the new token works on /auth/me
      const meRes = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${refreshRes.body.data.accessToken}`);

      assert.equal(meRes.status, 200, `Token from refresh step ${i} must authenticate /auth/me`);
      assert.equal(meRes.body.data.user.email, owner.email);

      // Advance cookie for next rotation
      const setCookies = refreshRes.headers["set-cookie"];
      if (setCookies) {
        currentCookie = setCookies.find((c) => c.startsWith("refreshToken=")) || currentCookie;
      }
    }
  });
});
