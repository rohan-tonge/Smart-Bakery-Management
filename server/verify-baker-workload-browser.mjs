import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import User from "./src/models/user.model.js";
import Category from "./src/models/category.model.js";
import Product from "./src/models/product.model.js";
import Recipe from "./src/models/recipe.model.js";
import ProductionBatch from "./src/models/productionBatch.model.js";
import { connectToDb, disconnectDb } from "./src/config/db.js";
import { PRODUCTION_STATUS as S } from "./src/utils/constants.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9255;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_workload_audit_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "baker_workload");

const VIEWPORT_WIDTHS = [
  { width: 375, height: 667, name: "375px_mobile" },
  { width: 430, height: 932, name: "430px_mobile_large" },
  { width: 768, height: 1024, name: "768px_tablet" },
  { width: 1366, height: 768, name: "1366px_desktop" },
  { width: 1920, height: 1080, name: "1920px_ultrawide" },
];

class SafeCdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const tm = setTimeout(() => reject(new Error("WS connection timeout")), 5000);
      this.ws.onopen = () => { clearTimeout(tm); resolve(); };
      this.ws.onerror = (e) => { clearTimeout(tm); reject(e); };
    });

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject, timer } = this.callbacks.get(msg.id);
          clearTimeout(timer);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch (err) {
        console.error("Message parse error:", err);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      const timer = setTimeout(() => {
        if (this.callbacks.has(msgId)) {
          this.callbacks.delete(msgId);
          reject(new Error(`CDP command ${method} timed out after 10000ms`));
        }
      }, 10000);
      this.callbacks.set(msgId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.value;
  }

  async setViewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
  }

  async captureScreenshot(outputPath) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    if (res && res.data) {
      await fs.writeFile(outputPath, Buffer.from(res.data, "base64"));
    }
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runAudit() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await connectToDb();

  // Create a busy baker fixture so we have a live active batch displayed
  const suffix = `audit-${Date.now()}`;
  let testBaker = await User.findOne({ email: "production@staff.com" });
  if (!testBaker) {
    testBaker = await User.findOne({ role: "PRODUCTION_STAFF", isActive: true });
  }

  let testCategory = await Category.findOne();
  if (!testCategory) {
    testCategory = await Category.create({ name: "Artisan Breads", slug: `breads-${suffix}` });
  }

  let testProduct = await Product.findOne({ isActive: true });
  let variantId = testProduct?.variants?.[0]?._id;
  if (!testProduct || !variantId) {
    variantId = new mongoose.Types.ObjectId();
    testProduct = await Product.create({
      name: "Chocolate Fudge Cake",
      slug: `choco-fudge-${suffix}`,
      category: testCategory._id,
      variants: [{ _id: variantId, name: "1kg", quantity: 1, unit: "piece", price: 650, isActive: true }],
    });
  }

  let testRecipe = await Recipe.findOne({ product: testProduct._id });
  if (!testRecipe) {
    testRecipe = await Recipe.create({
      product: testProduct._id,
      variant: variantId,
      name: "Choco Fudge Recipe",
      expectedYield: 5,
      yieldUnit: "piece",
      batchQuantity: 1,
      preparationTime: 15,
      productionTime: 30,
      estimatedDurationMinutes: 45,
      ingredients: [],
    });
  }

  // Ensure there is at least one active batch in IN_PRODUCTION for this baker
  let activeBatch = await ProductionBatch.findOne({
    "assignedWorkers.worker": testBaker._id,
    status: S.IN_PRODUCTION,
  });

  if (!activeBatch) {
    activeBatch = await ProductionBatch.create({
      batchNumber: `BATCH-LIVE-${Date.now().toString().slice(-4)}`,
      product: testProduct._id,
      productVariant: variantId,
      productSnapshot: {
        productName: testProduct.name,
        variantName: "1kg",
        variantQuantity: 1,
        variantUnit: "piece",
      },
      recipe: testRecipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 5,
        yieldUnit: "piece",
        recipeBatchQuantity: 1,
        preparationTime: 15,
        productionTime: 30,
        estimatedDurationMinutes: 45,
        ingredients: [],
      },
      plannedQuantity: 5,
      unit: "piece",
      status: S.IN_PRODUCTION,
      verificationStatus: "VERIFIED",
      consumptionStatus: "CONSUMED",
      verifiedAt: new Date(Date.now() - 30 * 60 * 1000),
      actualStartTime: new Date(Date.now() - 25 * 60 * 1000),
      bakingStartTime: new Date(Date.now() - 25 * 60 * 1000),
      estimatedDurationMinutes: 45,
      assignedWorkers: [
        {
          worker: testBaker._id,
          task: "Baking",
          taskStatus: "IN_PROGRESS",
          hourlyRateSnapshot: 180,
          actualHours: null,
        },
      ],
      createdBy: testBaker._id,
    });
  }

  console.log(`[Fixture] Active batch ready: ${activeBatch.batchNumber} assigned to ${testBaker.name}`);

  // Launch Chrome
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,OptimizationHints,MediaRouter",
    "--disable-background-networking",
    "--disable-component-update",
    "--mute-audio",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    let connected = false;
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      try {
        const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
        if (ver?.webSocketDebuggerUrl) {
          console.log(`[Browser] Connected to Chrome: ${ver.Browser}`);
          connected = true;
          break;
        }
      } catch (_) {}
    }
    if (!connected) throw new Error("Could not connect to Chrome debugging port");

    const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    let targetTab = tabs.find(t => t.type === "page") || await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: "PUT" })).json();

    const cdp = new SafeCdp(targetTab.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    // 1. Log in as owner
    console.log("\n[Auth] Logging in as Owner/Manager...");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/login" });
    await sleep(1500);

    const loginRes = await cdp.eval(`(async () => {
      try {
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@gmail.com', password: '123456' })
        });
        const data = await res.json();
        if (data.success && data.data?.accessToken) {
          localStorage.setItem('smart_bakery_token', data.data.accessToken);
          return { success: true, user: data.data.user };
        }
        return { success: false, message: data.message };
      } catch (e) {
        return { success: false, error: e.message };
      }
    })()`);

    console.log("Login result:", JSON.stringify(loginRes));
    if (!loginRes?.success) throw new Error("Failed to log in as owner");

    // 2. Navigate to Owner Dashboard Overview
    console.log("\n[Dashboard] Navigating to http://localhost:5173/owner?tab=overview...");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=overview" });
    await sleep(2000);

    // Verify Baker Workload Section exists
    const hasWorkloadSection = await cdp.eval(`Boolean(document.querySelector('.baker-workload-container'))`);
    console.log(`Baker Workload Section found in Overview: ${hasWorkloadSection}`);
    if (!hasWorkloadSection) throw new Error("Baker Workload section not found in DOM");

    const sectionDetails = await cdp.eval(`(() => {
      const el = document.querySelector('.baker-workload-container');
      const cards = document.querySelectorAll('.baker-workload-card');
      const busyCard = document.querySelector('.card-busy');
      const text = el ? el.innerText : '';
      return {
        cardCount: cards.length,
        hasBusyCard: Boolean(busyCard),
        textSnippet: text.slice(0, 300),
      };
    })()`);
    console.log("Section details:", JSON.stringify(sectionDetails, null, 2));

    // 3. Inspect across all 5 viewports
    const results = [];
    for (const vp of VIEWPORT_WIDTHS) {
      console.log(`\n--- Inspecting at ${vp.width}px x ${vp.height}px (${vp.name}) ---`);
      await cdp.setViewport(vp.width, vp.height);
      await sleep(1000);

      const check = await cdp.eval(`(() => {
        const docEl = document.documentElement;
        const body = document.body;
        const winW = window.innerWidth;
        const scrollW = Math.max(docEl.scrollWidth, body.scrollWidth);
        const hasHorizontalOverflow = scrollW > winW + 1;
        const container = document.querySelector('.baker-workload-container');
        const containerRect = container ? container.getBoundingClientRect() : null;

        return {
          winW,
          scrollW,
          hasHorizontalOverflow,
          overflowAmount: Math.max(0, scrollW - winW),
          containerWidth: containerRect ? Math.round(containerRect.width) : null,
          bakerCards: document.querySelectorAll('.baker-workload-card').length,
        };
      })()`);

      console.log(`Viewport ${vp.width}px check:`, JSON.stringify(check));
      assert.equal(check.hasHorizontalOverflow, false, `Horizontal overflow detected at ${vp.width}px!`);

      const screenshotFile = path.join(SCREENSHOT_DIR, `baker_workload_${vp.name}.png`);
      await cdp.captureScreenshot(screenshotFile);
      console.log(`Screenshot saved: ${screenshotFile}`);
      results.push({ ...vp, ...check, screenshot: screenshotFile });
    }

    // 4. Test clicking "Open Batch Details" modal
    console.log("\n[Modal] Testing Open Batch Details button click...");
    await cdp.eval(`(() => {
      const inspectBtn = document.querySelector('.card-busy button, .baker-workload-card button');
      if (inspectBtn) inspectBtn.click();
    })()`);
    await sleep(800);

    const modalCheck = await cdp.eval(`(() => {
      const modal = document.querySelector('.modal-backdrop');
      return {
        isOpen: Boolean(modal),
        heading: document.querySelector('#batch-modal-title')?.innerText || '',
        text: modal ? modal.innerText.slice(0, 200) : '',
      };
    })()`);
    console.log("Modal check:", JSON.stringify(modalCheck));
    assert.equal(modalCheck.isOpen, true, "Expected Batch Details modal to open!");

    const modalScreenshot = path.join(SCREENSHOT_DIR, "baker_workload_batch_modal_inspect.png");
    await cdp.captureScreenshot(modalScreenshot);
    console.log(`Modal screenshot saved: ${modalScreenshot}`);

    // Close modal
    await cdp.eval(`(() => {
      const closeBtn = document.querySelector('.modal-backdrop button');
      if (closeBtn) closeBtn.click();
    })()`);
    await sleep(500);

    // 5. Test Production Tab as well
    console.log("\n[Production Tab] Navigating to http://localhost:5173/owner?tab=production...");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=production" });
    await sleep(2000);

    const prodSectionCheck = await cdp.eval(`Boolean(document.querySelector('.baker-workload-container'))`);
    console.log(`Baker Workload Section found in Production Tab: ${prodSectionCheck}`);
    assert.equal(prodSectionCheck, true);

    const prodScreenshot = path.join(SCREENSHOT_DIR, "baker_workload_production_tab_1366px.png");
    await cdp.captureScreenshot(prodScreenshot);
    console.log(`Production tab screenshot saved: ${prodScreenshot}`);

    await cdp.close();
    console.log("\n=======================================================");
    console.log("SUCCESS: All 5 viewports inspected with ZERO overflow!");
    console.log("Live Baker Availability verified in actual Chrome browser!");
    console.log("=======================================================");
  } finally {
    try {
      chromeProc.kill();
      await fs.rm(TEMP_USER_DATA, { recursive: true, force: true });
    } catch (_) {}
    await disconnectDb();
  }
}

runAudit().catch((err) => {
  console.error("Audit failed with error:", err);
  process.exit(1);
});
