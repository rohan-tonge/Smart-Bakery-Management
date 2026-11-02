process.env.NODE_ENV = "test";

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";

test("Health Check Endpoint", async (t) => {
  await t.test("GET /api/v1/health should return 200 with standard success payload", async () => {
    const response = await request(app).get("/api/v1/health");

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.message, "Smart Bakery API is running");
    assert.ok(response.body.data);
    assert.equal(response.body.data.status, "healthy");
    assert.ok(response.body.data.timestamp);
  });

  await t.test("GET /api/v1/nonexistent should return 404 with standard error payload", async () => {
    const response = await request(app).get("/api/v1/nonexistent");

    assert.equal(response.status, 404);
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /Resource not found/);
    assert.ok(Array.isArray(response.body.errors));
  });

  await t.test("Response should include security headers from Helmet", async () => {
    const response = await request(app).get("/api/v1/health");

    assert.ok(response.headers["x-content-type-options"], "nosniff");
    assert.ok(response.headers["content-security-policy"]);
  });

  await t.test("CORS does not grant credentialed access to an unconfigured origin", async () => {
    const response = await request(app).get("/api/v1/health").set("Origin", "https://untrusted.example");
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    assert.equal(response.headers["access-control-allow-credentials"], undefined);
  });

  await t.test("readiness reports database connectivity without exposing configuration", async () => {
    const response = await request(app).get("/api/v1/health/ready");
    assert.ok([200, 503].includes(response.status));
    assert.ok(["ready", "not_ready"].includes(response.body.data.status));
    assert.equal(JSON.stringify(response.body).includes("mongodb://"), false);
  });
});
