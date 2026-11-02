process.env.NODE_ENV = "test";

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import { USER_ROLES } from "../src/utils/constants.js";
import jwt from "jsonwebtoken";
import config from "../src/config/config.js";

test("Phase 2: Authentication, Users & Authorization", async (t) => {
  // Ensure DB connection
  await connectToDb();
  await User.deleteMany({ email: /.*test\.com$/ });

  t.after(async () => {
    try {
      await User.deleteMany({ email: /.*test\.com$/ });
    } finally {
      await disconnectDb();
    }
  });

  const testCustomer = {
    name: "John Baker",
    email: "john.baker@test.com",
    password: "Password123!",
    phone: "9876543210",
  };

  let customerAccessToken = "";
  let customerRefreshTokenCookie = "";
  let customerId = "";
  let ownerAccessToken = "";

  // 1. Register customer successfully
  await t.test("1. Register customer successfully", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(testCustomer);

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, "Registration successful");
    assert.ok(res.body.data.user);
    assert.equal(res.body.data.user.email, testCustomer.email);
    assert.equal(res.body.data.user.role, USER_ROLES.CUSTOMER);
    assert.ok(res.body.data.accessToken);

    customerAccessToken = res.body.data.accessToken;
    customerId = res.body.data.user._id;

    const cookies = res.headers["set-cookie"];
    assert.ok(cookies, "set-cookie header should be present");
    const refreshCookie = cookies.find((c) => c.startsWith("refreshToken="));
    assert.ok(refreshCookie, "refreshToken cookie should be set");
    assert.match(refreshCookie, /HttpOnly/i);

    customerRefreshTokenCookie = refreshCookie.split(";")[0];
  });

  // 2. Duplicate email returns 409
  await t.test("2. Duplicate email returns 409 Conflict", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(testCustomer);

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /already exists/i);
  });

  // 3. Password is properly hashed
  await t.test("3. Password is properly hashed in database", async () => {
    const dbUser = await User.findById(customerId).select("+password");
    assert.ok(dbUser);
    assert.notEqual(dbUser.password, testCustomer.password);
    assert.match(dbUser.password, /^\$2[aby]\$\d+\$/);
  });

  // 4. Password is never returned in API responses
  await t.test("4. Password is never returned in API responses", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: testCustomer.email,
        password: testCustomer.password,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.password, undefined);
    assert.equal(res.body.data.user.refreshTokenHash, undefined);
  });

  // 5. Login with valid credentials
  await t.test("5. Login with valid credentials", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: testCustomer.email,
        password: testCustomer.password,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.accessToken);
    assert.equal(res.body.data.user.email, testCustomer.email);

    customerAccessToken = res.body.data.accessToken;
    const cookies = res.headers["set-cookie"];
    const refreshCookie = cookies.find((c) => c.startsWith("refreshToken="));
    customerRefreshTokenCookie = refreshCookie.split(";")[0];
  });

  // 6. Login with invalid credentials returns generic 401
  await t.test("6. Login with invalid credentials returns generic 401", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: testCustomer.email,
        password: "WrongPassword999",
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Invalid email or password");
  });

  // 7. Login inactive user is rejected
  await t.test("7. Inactive user login is rejected with 401", async () => {
    const inactiveUser = await User.create({
      name: "Inactive User",
      email: "inactive@test.com",
      password: "Password123!",
      role: USER_ROLES.CUSTOMER,
      isActive: false,
    });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: inactiveUser.email,
        password: "Password123!",
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /deactivated/i);
  });

  // 8. Access protected endpoint without token returns 401
  await t.test("8. Access protected endpoint without token returns 401", async () => {
    const res = await request(app).get("/api/v1/auth/me");

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  // 9. Access protected endpoint with invalid token returns 401
  await t.test("9. Access protected endpoint with invalid token returns 401", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer invalid.token.payload");

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  await t.test("expired access tokens are rejected", async () => {
    const expired = jwt.sign({ sub: customerId, role: USER_ROLES.CUSTOMER }, config.jwt.accessTokenSecret, { algorithm: "HS256", expiresIn: -1 });
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${expired}`);
    assert.equal(res.status, 401);
    assert.match(res.body.message, /expired/i);
  });

  // 10. Access protected endpoint with valid token returns 200
  await t.test("10. Access protected endpoint with valid token returns 200", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${customerAccessToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.email, testCustomer.email);
  });

  // Create Owner for role authorization tests
  const ownerUser = await User.create({
    name: "Bakery Owner",
    email: "owner@test.com",
    password: "Password123!",
    role: USER_ROLES.OWNER,
    isActive: true,
  });

  const ownerLoginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({
      email: ownerUser.email,
      password: "Password123!",
    });
  ownerAccessToken = ownerLoginRes.body.data.accessToken;

  await t.test("OWNER cannot remove the last active OWNER", async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${ownerUser._id}/role`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ role: USER_ROLES.MANAGER });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /last remaining active OWNER/i);
  });

  // 11. CUSTOMER cannot access OWNER-only endpoint (403 Forbidden)
  await t.test("11. CUSTOMER cannot access OWNER-only endpoint (403 Forbidden)", async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${customerId}/role`)
      .set("Authorization", `Bearer ${customerAccessToken}`)
      .send({ role: USER_ROLES.MANAGER });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /forbidden/i);
  });

  // 12. OWNER can access OWNER-only endpoint (200 OK)
  await t.test("12. OWNER can access OWNER-only endpoint (200 OK)", async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${customerId}/role`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ role: USER_ROLES.PRODUCTION_STAFF });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.role, USER_ROLES.PRODUCTION_STAFF);

    // Revert role back to CUSTOMER
    await User.findByIdAndUpdate(customerId, { role: USER_ROLES.CUSTOMER });
  });

  // 13. /me returns authenticated user details without password or tokens
  await t.test("13. /me returns authenticated user details without sensitive fields", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${customerAccessToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, testCustomer.email);
    assert.equal(res.body.data.user.name, testCustomer.name);
    assert.equal(res.body.data.user.password, undefined);
    assert.equal(res.body.data.user.refreshTokenHash, undefined);
  });

  // 14. Refresh token works, rotates, and can only be consumed once concurrently
  await t.test("14. Refresh token rotation is atomic under duplicate requests", async () => {
    const staleCookie = customerRefreshTokenCookie;
    const responses = await Promise.all([0, 1].map(() => request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", [staleCookie])));

    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
    const winner = responses.find((response) => response.status === 200);
    assert.ok(winner.body.data.accessToken);
    const refreshCookie = winner.headers["set-cookie"].find((cookie) => cookie.startsWith("refreshToken="));
    assert.ok(refreshCookie);
    customerRefreshTokenCookie = refreshCookie.split(";")[0];
    customerAccessToken = winner.body.data.accessToken;
  });

  // 15. Logout invalidates refresh token and clears cookie
  await t.test("15. Logout invalidates refresh token and clears cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${customerAccessToken}`)
      .set("Cookie", [customerRefreshTokenCookie]);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const cookies = res.headers["set-cookie"];
    const refreshCookie = cookies.find((c) => c.startsWith("refreshToken="));
    assert.ok(refreshCookie);

    // Replay attempt with logged out cookie should fail
    const replayRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", [customerRefreshTokenCookie]);

    assert.equal(replayRes.status, 401);
  });

  // 16. Change password works
  let newPassword = "NewSecretPassword456!";
  await t.test("16. Change password works with valid credentials", async () => {
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: testCustomer.email,
        password: testCustomer.password,
      });

    const activeToken = loginRes.body.data.accessToken;

    const res = await request(app)
      .patch("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${activeToken}`)
      .send({
        currentPassword: testCustomer.password,
        newPassword: newPassword,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  // 17. Old password no longer works after password change
  await t.test("17. Old password no longer works after password change", async () => {
    const oldLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: testCustomer.email,
        password: testCustomer.password,
      });

    assert.equal(oldLoginRes.status, 401);

    const newLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: testCustomer.email,
        password: newPassword,
      });

    assert.equal(newLoginRes.status, 200);
    assert.equal(newLoginRes.body.success, true);
  });

  // 18. Client cannot register itself as OWNER
  await t.test("18. Public registration request with role OWNER defaults to CUSTOMER", async () => {
    const maliciousPayload = {
      name: "Sneaky User",
      email: "sneaky@test.com",
      password: "Password123!",
      role: USER_ROLES.OWNER,
    };

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(maliciousPayload);

    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.role, USER_ROLES.CUSTOMER);

    const dbRecord = await User.findOne({ email: maliciousPayload.email });
    assert.equal(dbRecord.role, USER_ROLES.CUSTOMER);
  });

  // 19. OWNER lists users with pagination
  await t.test("19. OWNER lists users with pagination metadata", async () => {
    const res = await request(app)
      .get("/api/v1/users?page=1&limit=10")
      .set("Authorization", `Bearer ${ownerAccessToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.users));
    assert.ok(res.body.meta);
    assert.equal(res.body.meta.page, 1);
    assert.ok(res.body.meta.total >= 1);
  });

  // 20. CUSTOMER cannot list users (403)
  await t.test("20. CUSTOMER cannot list users (403 Forbidden)", async () => {
    const res = await request(app)
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${customerAccessToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });

  // 21. OWNER gets user by ID
  await t.test("21. OWNER gets user by ID", async () => {
    const res = await request(app)
      .get(`/api/v1/users/${customerId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user._id, customerId);
  });

  // 22. OWNER updates user status
  await t.test("22. OWNER deactivates and reactivates a user", async () => {
    // Deactivate
    const deactRes = await request(app)
      .patch(`/api/v1/users/${customerId}/status`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ isActive: false });

    assert.equal(deactRes.status, 200);
    assert.equal(deactRes.body.data.user.isActive, false);

    // Reactivate
    const reactRes = await request(app)
      .patch(`/api/v1/users/${customerId}/status`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ isActive: true });

    assert.equal(reactRes.status, 200);
    assert.equal(reactRes.body.data.user.isActive, true);
  });

  // 23. User cannot deactivate their own account
  await t.test("23. User cannot deactivate their own account", async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${ownerUser._id}/status`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ isActive: false });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /cannot deactivate your own account/i);
  });

  // 24. Combined OWNER_MANAGER can access management APIs, view other users, and inspect settings
  await t.test("24. OWNER_MANAGER role reaches combined management APIs and can view other profiles", async () => {
    const omUser = await User.create({
      name: "Combined Owner Manager",
      email: "owner.manager.combined@test.com",
      password: "Password123!",
      role: USER_ROLES.OWNER_MANAGER,
      isActive: true,
    });

    const omLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: omUser.email, password: "Password123!" });
    assert.equal(omLogin.status, 200);
    const omToken = omLogin.body.data.accessToken;
    const omAuth = { Authorization: `Bearer ${omToken}` };

    // OWNER_MANAGER can view another user's profile (fixed defect)
    const viewUserRes = await request(app).get(`/api/v1/users/${customerId}`).set(omAuth);
    assert.equal(viewUserRes.status, 200);
    assert.equal(viewUserRes.body.data.user._id, customerId);

    // OWNER_MANAGER can access user listing
    const listUsersRes = await request(app).get("/api/v1/users").set(omAuth);
    assert.equal(listUsersRes.status, 200);

    // OWNER_MANAGER can access production capacity configuration
    const capRes = await request(app).get("/api/v1/settings/production-capacity").set(omAuth);
    assert.equal(capRes.status, 200);

    // OWNER_MANAGER can access inventory valuation
    const valRes = await request(app).get("/api/v1/inventory/value").set(omAuth);
    assert.equal(valRes.status, 200);

    await User.deleteOne({ _id: omUser._id });
  });

  // 25. PRODUCTION_STAFF is restricted to production workflow and denied management operations
  await t.test("25. PRODUCTION_STAFF reaches production workflow but is denied management APIs", async () => {
    const staffUser = await User.create({
      name: "Floor Worker",
      email: "floor.worker@test.com",
      password: "Password123!",
      role: USER_ROLES.PRODUCTION_STAFF,
      isActive: true,
    });

    const staffLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: staffUser.email, password: "Password123!" });
    assert.equal(staffLogin.status, 200);
    const staffToken = staffLogin.body.data.accessToken;
    const staffAuth = { Authorization: `Bearer ${staffToken}` };

    // Staff can access assigned batch workflow
    const batchRes = await request(app).get("/api/v1/workers/me/batches").set(staffAuth);
    assert.equal(batchRes.status, 200);

    // Staff denied user management
    const usersRes = await request(app).get("/api/v1/users").set(staffAuth);
    assert.equal(usersRes.status, 403);

    // Staff denied inventory valuation
    const valRes = await request(app).get("/api/v1/inventory/value").set(staffAuth);
    assert.equal(valRes.status, 403);

    // Staff denied capacity configuration
    const capRes = await request(app).get("/api/v1/settings/production-capacity").set(staffAuth);
    assert.equal(capRes.status, 403);

    // Staff denied supplier purchases
    const purchaseRes = await request(app).get("/api/v1/purchases").set(staffAuth);
    assert.equal(purchaseRes.status, 403);

    // Staff denied financial costing summary
    const costRes = await request(app).get("/api/v1/costing/summary?date=2026-10-11").set(staffAuth);
    assert.equal(costRes.status, 403);

    // Staff denied profitability metrics
    const profitRes = await request(app).get("/api/v1/analytics/profitability").set(staffAuth);
    assert.equal(profitRes.status, 403);

    // Staff denied payment detail
    const payRes = await request(app).get("/api/v1/payments/6acba751b9254915d489837c").set(staffAuth);
    assert.equal(payRes.status, 403);

    await User.deleteOne({ _id: staffUser._id });
  });

  // 26. Legacy MANAGER is granted manager operations but denied owner-only operations
  await t.test("26. Legacy MANAGER can access manager endpoints but is denied owner-only operations", async () => {
    const mgrUser = await User.create({
      name: "Legacy Manager",
      email: "legacy.manager@test.com",
      password: "Password123!",
      role: "MANAGER",
      isActive: true,
    });

    const mgrLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: mgrUser.email, password: "Password123!" });
    assert.equal(mgrLogin.status, 200);
    const mgrToken = mgrLogin.body.data.accessToken;
    const mgrAuth = { Authorization: `Bearer ${mgrToken}` };

    // Legacy manager can list users
    const listRes = await request(app).get("/api/v1/users").set(mgrAuth);
    assert.equal(listRes.status, 200);

    // Legacy manager is denied owner-only role modification
    const roleRes = await request(app)
      .patch(`/api/v1/users/${customerId}/role`)
      .set(mgrAuth)
      .send({ role: USER_ROLES.PRODUCTION_STAFF });
    assert.equal(roleRes.status, 403);

    // Legacy manager is denied owner-only inventory valuation
    const valRes = await request(app).get("/api/v1/inventory/value").set(mgrAuth);
    assert.equal(valRes.status, 403);

    await User.deleteOne({ _id: mgrUser._id });
  });

  // 27. Server-side authorization blocks CUSTOMER from management routes even if requested directly
  await t.test("27. Server-side authorization blocks CUSTOMER from management routes", async () => {
    const custRes1 = await request(app).get("/api/v1/users").set("Authorization", `Bearer ${customerAccessToken}`);
    assert.equal(custRes1.status, 403);

    const custRes2 = await request(app).get("/api/v1/inventory/value").set("Authorization", `Bearer ${customerAccessToken}`);
    assert.equal(custRes2.status, 403);

    const custRes3 = await request(app).get("/api/v1/settings/production-capacity").set("Authorization", `Bearer ${customerAccessToken}`);
    assert.equal(custRes3.status, 403);
  });
});
