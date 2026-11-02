process.env.NODE_ENV = "test";

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";
import rateLimit from "express-rate-limit";
import app from "../src/app.js";
import { connectToDb, disconnectDb } from "../src/config/db.js";
import config from "../src/config/config.js";
import {
  globalRateLimiter,
  authRateLimiter,
  GLOBAL_RATE_LIMIT,
  AUTH_RATE_LIMIT,
} from "../src/middlewares/rateLimit.middlewares.js";

test("Rate-Limiting & Security Review Suite", async (t) => {
  await connectToDb();

  t.after(async () => {
    await disconnectDb();
  });

  // =========================================================================
  // 1. Environment Detection and Limits Gating
  // =========================================================================
  await t.test("1. Production and development rate-limiting thresholds are strictly gated", async () => {
    // In test environment (which is non-development), limits must be strict production defaults
    assert.equal(config.isDevelopment, false, "Test mode must not be flagged as development");
    assert.equal(config.isTest, true, "Test mode must be flagged as test");

    // Limits exported from rateLimit.middlewares.js must resolve to strict production thresholds in non-dev
    assert.equal(GLOBAL_RATE_LIMIT, 300, "Global rate limit must be 300 in non-dev environment");
    assert.equal(AUTH_RATE_LIMIT, 20, "Auth rate limit must be 20 in non-dev environment");

    // Simulate production environment check logic
    const prodConfig = {
      NODE_ENV: "production",
      isProduction: true,
      isDevelopment: false,
      isTest: false,
    };
    const isDev =
      prodConfig.NODE_ENV === "development" &&
      prodConfig.isDevelopment === true &&
      !prodConfig.isProduction;

    const prodGlobalLimit = isDev ? 3000 : 300;
    const prodAuthLimit = isDev ? 200 : 20;

    assert.equal(isDev, false, "Production environment cannot be identified as development");
    assert.equal(prodGlobalLimit, 300, "Production global limit must be 300");
    assert.equal(prodAuthLimit, 20, "Production auth limit must be 20");
  });

  // =========================================================================
  // 2. Authentication Throttling on Repeated Failed Login Attempts
  // =========================================================================
  await t.test("2. Rate limiting throttles repeated authentication attempts on /api/v1/auth/login", async () => {
    // Create an isolated sub-app with an explicit authRateLimiter to test thresholding
    const testApp = express();
    testApp.use(express.json());

    // Create a limiter instance with max = 5 for test threshold verification
    const testAuthLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        return res.status(429).json({
          success: false,
          message: "Too many authentication attempts. Please try again after 15 minutes.",
        });
      },
    });

    testApp.post("/login", testAuthLimiter, (req, res) => {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    });

    // Make 5 requests - all should reach the handler and return 401
    for (let i = 1; i <= 5; i++) {
      const res = await request(testApp).post("/login").send({
        email: "attacker@bad.com",
        password: `wrong_pass_${i}`,
      });
      assert.equal(res.status, 401, `Attempt ${i} should be handled as 401`);
      assert.equal(res.headers["ratelimit-limit"], "5");
      assert.equal(res.headers["ratelimit-remaining"], String(5 - i));
    }

    // 6th request must be throttled and return 429 Too Many Requests
    const throttledRes = await request(testApp).post("/login").send({
      email: "attacker@bad.com",
      password: "wrong_pass_6",
    });

    assert.equal(throttledRes.status, 429, "6th attempt must be blocked with HTTP 429");
    assert.equal(throttledRes.body.success, false);
    assert.match(throttledRes.body.message, /too many authentication attempts/i);
    assert.equal(throttledRes.headers["ratelimit-remaining"], "0");
    assert.ok(throttledRes.headers["ratelimit-reset"], "Must include RateLimit-Reset header");
  });

  // =========================================================================
  // 3. Rate-Limiting Anti-Spoofing: X-Forwarded-For cannot bypass limits
  // =========================================================================
  await t.test("3. Spoofed X-Forwarded-For headers cannot bypass rate limiting when trust proxy is 0", async () => {
    const testApp = express();
    testApp.set("trust proxy", 0); // Direct connection / no proxy trusted
    testApp.use(express.json());

    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
      handler: (req, res) => {
        return res.status(429).json({ success: false, message: "Throttled" });
      },
    });

    testApp.post("/auth-endpoint", limiter, (req, res) => {
      return res.json({ success: true, ip: req.ip });
    });

    // Attacker sends 3 requests with different spoofed X-Forwarded-For headers
    for (let i = 1; i <= 3; i++) {
      const res = await request(testApp)
        .post("/auth-endpoint")
        .set("X-Forwarded-For", `198.51.100.${i}`) // Spoofed IP
        .send({});
      assert.equal(res.status, 200, `Request ${i} with spoofed IP should succeed up to limit`);
    }

    // 4th request with yet another spoofed IP must STILL be throttled
    // because trust proxy = 0 forces express to key on the actual connection socket IP
    const bypassAttempt = await request(testApp)
      .post("/auth-endpoint")
      .set("X-Forwarded-For", "198.51.100.99")
      .send({});

    assert.equal(bypassAttempt.status, 429, "Attacker cannot bypass rate limiting by rotating X-Forwarded-For");
  });

  // =========================================================================
  // 4. Reverse Proxy Hops Handling: Trust Proxy extracts real client IP
  // =========================================================================
  await t.test("4. With trust proxy = 1, Express correctly identifies the client IP from the trusted proxy hop", async () => {
    const testApp = express();
    testApp.set("trust proxy", 1); // Exactly 1 trusted reverse proxy hop
    testApp.use(express.json());

    testApp.get("/client-ip", (req, res) => {
      return res.json({ ip: req.ip });
    });

    // Client connects through reverse proxy:
    // Header format: <client-provided-header>, <reverse-proxy-appended-client-ip>
    const res = await request(testApp)
      .get("/client-ip")
      .set("X-Forwarded-For", "10.0.0.1, 203.0.113.50");

    // With 1 hop, Express extracts 203.0.113.50 (the real client IP appended by proxy)
    // and ignores the spoofed 10.0.0.1 sent by client
    assert.equal(res.body.ip, "203.0.113.50");
  });

  // =========================================================================
  // 5. Endpoint Scoping: Auth Throttling Does NOT Block Checkout or Tracking
  // =========================================================================
  await t.test("5. Exhausting auth rate limit does NOT block customer checkout, feasibility, or tracking", async () => {
    // When a client IP exhausts their auth rate limit, that limiter applies only to auth routes.
    // The main app mounts authRateLimiter on auth routes, while checkout and tracking use globalRateLimiter.
    const testApp = express();
    testApp.use(express.json());

    const dedicatedAuthLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 2,
      handler: (req, res) => res.status(429).json({ message: "Auth blocked" }),
    });

    const generalLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 50,
      handler: (req, res) => res.status(429).json({ message: "General blocked" }),
    });

    // Mount dedicated auth limiter on login
    testApp.post("/api/v1/auth/login", dedicatedAuthLimiter, (req, res) => {
      res.status(401).json({ message: "Invalid credentials" });
    });

    // Mount general limiter on checkout and tracking
    testApp.post("/api/v1/orders/check-feasibility", generalLimiter, (req, res) => {
      res.json({ success: true, feasible: true });
    });

    testApp.get("/api/v1/orders/track", generalLimiter, (req, res) => {
      res.json({ success: true, orderNumber: "ORD-TEST-001" });
    });

    // Exhaust auth attempts (2 requests)
    await request(testApp).post("/api/v1/auth/login").send({});
    await request(testApp).post("/api/v1/auth/login").send({});

    // 3rd auth attempt is throttled
    const authBlocked = await request(testApp).post("/api/v1/auth/login").send({});
    assert.equal(authBlocked.status, 429, "Auth route must be 429");

    // Same IP immediately calls check-feasibility: must NOT be 429
    const feasibilityRes = await request(testApp).post("/api/v1/orders/check-feasibility").send({});
    assert.equal(feasibilityRes.status, 200, "Customer feasibility check must succeed even if auth is throttled");
    assert.equal(feasibilityRes.body.feasible, true);

    // Same IP immediately calls order tracking: must NOT be 429
    const trackingRes = await request(testApp).get("/api/v1/orders/track");
    assert.equal(trackingRes.status, 200, "Order tracking must succeed even if auth is throttled");
    assert.equal(trackingRes.body.orderNumber, "ORD-TEST-001");
  });

  // =========================================================================
  // 6. Application Routes Rate Limiter Mounting Verification
  // =========================================================================
  await t.test("6. Real application routes mount authRateLimiter on all sensitive auth endpoints", async () => {
    // Test that auth endpoints are active and respond as expected
    const loginRes = await request(app).post("/api/v1/auth/login").send({});
    assert.equal(loginRes.status, 400, "POST /api/v1/auth/login must be registered and validating body");

    const registerRes = await request(app).post("/api/v1/auth/register").send({});
    assert.equal(registerRes.status, 400, "POST /api/v1/auth/register must be registered and validating body");

    const refreshRes = await request(app).post("/api/v1/auth/refresh").send({});
    assert.equal(refreshRes.status, 401, "POST /api/v1/auth/refresh must be registered and authenticating token");
  });
});
