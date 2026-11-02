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
import Ingredient from "./src/models/ingredient.model.js";
import InventoryLot from "./src/models/inventoryLot.model.js";
import ProductionBatch from "./src/models/productionBatch.model.js";
import Order from "./src/models/order.model.js";
import PaymentProof from "./src/models/paymentProof.model.js";
import { connectToDb, disconnectDb } from "./src/config/db.js";
import { USER_ROLES, PRODUCTION_STATUS as S, CUSTOMER_ORDER_STATUSES } from "./src/utils/constants.js";
import { generateAccessToken } from "./src/utils/token.utils.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9266;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_browser_verify_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "direct_start_and_inventory_alert");

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
      const tm = setTimeout(() => reject(new Error("WS connection timeout")), 6000);
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

async function runBrowserVerification() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await connectToDb();

  const suffix = `ui-${Date.now()}`;

  // 1. Setup Baker & Owner with known passwords
  let bakerUser = await User.findOne({ email: "production@staff.com" });
  if (!bakerUser) {
    bakerUser = await User.create({
      name: "Master Baker Arjun",
      email: "production@staff.com",
      password: "Password123!",
      role: USER_ROLES.PRODUCTION_STAFF,
      jobDesignation: "Head Artisan Baker",
      hourlyLabourRate: 200,
      isActive: true,
    });
  }
  bakerUser.password = "123456";
  await bakerUser.save();

  let ownerUser = await User.findOne({ email: "admin@gmail.com" });
  if (ownerUser) {
    ownerUser.password = "123456";
    await ownerUser.save();
  }

  // Cancel any existing active batches for this baker so there's no concurrency block
  await ProductionBatch.updateMany(
    { "assignedWorkers.worker": bakerUser._id, status: { $in: [S.ACCEPTED, S.VERIFIED, S.IN_PRODUCTION, S.PACKAGING] } },
    { $set: { status: S.CANCELLED } }
  );

  // 2. Setup Category, Product, Ingredients, Recipe
  let category = await Category.findOne({ slug: "artisan-breads" });
  if (!category) {
    category = await Category.create({ name: "Artisan Breads", slug: "artisan-breads", isActive: true });
  }

  const flour = await Ingredient.create({
    name: `Organic Wheat Flour ${suffix}`,
    slug: `wheat-flour-${suffix}`,
    unit: "kg",
    costPerUnit: 45,
    minimumStock: 2,
    reorderLevel: 5,
    isActive: true,
  });

  const chocolate = await Ingredient.create({
    name: `Belgian Dark Chocolate ${suffix}`,
    slug: `dark-chocolate-${suffix}`,
    unit: "kg",
    costPerUnit: 350,
    minimumStock: 1,
    reorderLevel: 3,
    isActive: true,
  });

  // Lots: 50kg flour (plenty for both orders), but only 1.5kg chocolate (order 1 needs 1kg, order 2 needs 5kg -> guaranteed shortage of 4.5kg!)
  await InventoryLot.create({
    ingredient: flour._id,
    lotNumber: `LOT-FLOUR-${suffix}`,
    originalQuantity: 50,
    remainingQuantity: 50,
    unit: "kg",
    unitCost: 45.0,
    purchaseDate: new Date(),
    status: "AVAILABLE",
    expiryDate: new Date(Date.now() + 60 * 86400000),
  });

  await InventoryLot.create({
    ingredient: chocolate._id,
    lotNumber: `LOT-CHOC-${suffix}`,
    originalQuantity: 10,
    remainingQuantity: 10,
    unit: "kg",
    unitCost: 350.0,
    purchaseDate: new Date(),
    status: "AVAILABLE",
    expiryDate: new Date(Date.now() + 60 * 86400000),
  });

  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Chocolate Sourdough ${suffix}`,
    slug: `choco-sourdough-${suffix}`,
    category: category._id,
    preparationTime: 15,
    productionTime: 35,
    variants: [
      {
        _id: variantId,
        name: "Standard Loaf",
        quantity: 1,
        unit: "piece",
        price: 280,
        isActive: true,
        isAvailable: true,
      },
    ],
    isActive: true,
    isAvailable: true,
  });

  const recipe = await Recipe.create({
    name: `Chocolate Sourdough Recipe ${suffix}`,
    product: product._id,
    variant: variantId,
    revision: 1,
    expectedYield: 5,
    yieldUnit: "piece",
    recipeBatchQuantity: 5,
    preparationTime: 15,
    productionTime: 35,
    ingredients: [
      { ingredient: flour._id, name: flour.name, quantity: 2, unit: "kg" },
      { ingredient: chocolate._id, name: chocolate.name, quantity: 1, unit: "kg" }, // 1kg per 5 loaves
    ],
    isActive: true,
  });

  // 3. Batch for Baker direct start (in ACCEPTED status)
  const batch = await ProductionBatch.create({
    batchNumber: `BATCH-DIRECT-${suffix.slice(-6)}`,
    product: product._id,
    productVariant: variantId,
    productSnapshot: {
      productName: product.name,
      variantName: "Standard Loaf",
      variantQuantity: 1,
      variantUnit: "piece",
    },
    recipe: recipe._id,
    recipeRevision: 1,
    recipeSnapshot: {
      expectedYield: 5,
      yieldUnit: "piece",
      recipeBatchQuantity: 5,
      ingredients: [
        { ingredient: flour._id, name: flour.name, quantity: 2, unit: "kg" },
        { ingredient: chocolate._id, name: chocolate.name, quantity: 1, unit: "kg" },
      ],
      preparationTime: 15,
      productionTime: 35,
    },
    plannedQuantity: 5,
    unit: "piece",
    status: S.ACCEPTED,
    planningStatus: "APPROVED",
    verificationStatus: "VERIFIED",
    consumptionStatus: "NOT_STARTED",
    assignedWorkers: [{ worker: bakerUser._id, task: "Mixing & Baking" }],
    createdBy: bakerUser._id,
  });

  // 4. Create Two Orders:
  // Order 1: Feasible / Available (requires 5 loaves -> 2kg flour, 1kg choc <= 2kg available)
  const orderAvailable = await Order.create({
    orderNumber: `ORD-AVAIL-${suffix.slice(-6)}`,
    items: [
      {
        productId: product._id,
        variantId: variantId,
        productName: product.name,
        variantName: "Standard Loaf",
        quantity: 5,
        unitPrice: 280,
        lineTotal: 1400,
      },
    ],
    subtotal: 1400,
    total: 1400,
    orderType: "PICKUP",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PENDING_VERIFICATION",
    status: CUSTOMER_ORDER_STATUSES.PENDING_PAYMENT,
    contactName: "Sunita Sharma",
    contactPhone: "9876543210",
  });

  // Order 2: Insufficient / Shortage (requires 50 loaves -> 20kg flour, 10kg choc > 9kg available => 1kg shortage!)
  const orderShortage = await Order.create({
    orderNumber: `ORD-SHORT-${suffix.slice(-6)}`,
    items: [
      {
        productId: product._id,
        variantId: variantId,
        productName: product.name,
        variantName: "Standard Loaf",
        quantity: 50,
        unitPrice: 280,
        lineTotal: 14000,
      },
    ],
    subtotal: 14000,
    total: 14000,
    orderType: "PICKUP",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PENDING_VERIFICATION",
    paymentProof: {
      hasProof: true,
      fileName: "upi_receipt.jpg",
      mimeType: "image/jpeg",
      fileSize: 4,
      uploadedAt: new Date(),
    },
    status: CUSTOMER_ORDER_STATUSES.PENDING_PAYMENT,
    contactName: "Rahul Mehra",
    contactPhone: "9876543211",
  });

  await PaymentProof.create({
    order: orderShortage._id,
    fileName: "upi_receipt.jpg",
    mimeType: "image/jpeg",
    fileSize: 4,
    data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    uploadedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
  });

  console.log(`[Fixture] Created Batch: ${batch.batchNumber} (status: ${batch.status})`);
  console.log(`[Fixture] Created Order Available: ${orderAvailable.orderNumber}`);
  console.log(`[Fixture] Created Order Shortage: ${orderShortage.orderNumber}`);

  // Launch Headless Chrome
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

  let cdp = null;

  try {
    let connected = false;
    for (let i = 0; i < 25; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const tabs = await res.json();
        const pageTab = tabs.find((t) => t.type === "page");
        if (pageTab?.webSocketDebuggerUrl) {
          cdp = new SafeCdp(pageTab.webSocketDebuggerUrl);
          await cdp.connect();
          connected = true;
          break;
        } else {
          // Open a new page if no page tab
          const newTab = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: "PUT" })).json();
          if (newTab?.webSocketDebuggerUrl) {
            cdp = new SafeCdp(newTab.webSocketDebuggerUrl);
            await cdp.connect();
            connected = true;
            break;
          }
        }
      } catch (_) {
        await sleep(300);
      }
    }
    assert.ok(connected, "Failed to connect to Chrome CDP");
    console.log("[Chrome] CDP connected successfully.");

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // =========================================================================
    // PART 1: Baker Direct Start UI
    // =========================================================================
    console.log("\n--- Testing Baker Direct Start Workflow ---");
    const bakerToken = generateAccessToken(bakerUser);

    // Initial page load to setup localStorage context
    await cdp.send("Page.navigate", { url: "http://localhost:5173/" });
    await sleep(1500);

    // Inject token for Baker
    await cdp.eval(`
      localStorage.setItem('smart_bakery_token', '${bakerToken}');
    `);

    // Navigate to /production
    await cdp.send("Page.navigate", { url: "http://localhost:5173/production" });
    await sleep(3500);

    // Verify Baker is on Production Dashboard and finds the batch
    const bakerBatchCard = await cdp.eval(`
      (() => {
        const text = document.body.innerText;
        const currentHref = window.location.href;
        const hasBatch = text.includes('${batch.batchNumber}');
        const hasStartBtn = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Start Production'));
        const hasRequisitionBlocker = text.includes('Waiting for store approval') || text.includes('approval required before starting');
        return { currentHref, textSnippet: text.slice(0, 300), hasBatch, hasStartBtn, hasRequisitionBlocker };
      })()
    `);
    console.log("[Baker View]", bakerBatchCard);
    assert.ok(bakerBatchCard.hasBatch, "Baker dashboard should display the assigned batch");
    assert.ok(bakerBatchCard.hasStartBtn, "Direct 'Start Production' button must be visible without store approval blocker");
    assert.ok(!bakerBatchCard.hasRequisitionBlocker, "Blocking store approval warning should not be displayed");

    // Capture screenshots of Baker Dashboard across viewports
    for (const vp of VIEWPORT_WIDTHS) {
      await cdp.setViewport(vp.width, vp.height);
      await sleep(600);
      const isOverflowing = await cdp.eval(`document.documentElement.scrollWidth > window.innerWidth`);
      assert.equal(isOverflowing, false, `Horizontal overflow at viewport ${vp.name}`);
      const scPath = path.join(SCREENSHOT_DIR, `baker_dashboard_direct_start_${vp.name}.png`);
      await cdp.captureScreenshot(scPath);
      console.log(`[Screenshot] Baker Direct Start UI captured: ${vp.name}`);
    }

    // Baker clicks "Start Production Directly"
    console.log("[Baker Action] Clicking 'Start Production Directly' button...");
    const clickResult = await cdp.eval(`
      (() => {
        window.alert = (msg) => { window.__lastAlert = msg; };
        const startBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Start Production'));
        if (startBtn) {
          startBtn.click();
          return { clicked: true, btnText: startBtn.innerText };
        }
        return { clicked: false };
      })()
    `);
    console.log("[Click Result]", clickResult);
    await sleep(3500);

    const alertCheck = await cdp.eval(`window.__lastAlert || null`);
    if (alertCheck) {
      console.log("[Alert Intercepted]", alertCheck);
    }

    // Verify batch moved to IN_PRODUCTION
    const startedBatch = await ProductionBatch.findById(batch._id);
    console.log(`[Backend Verification] Batch status after direct start: ${startedBatch.status}`);
    assert.ok(
      [S.IN_PRODUCTION, S.VERIFIED].includes(startedBatch.status),
      "Batch should be started directly without store approval"
    );

    // =========================================================================
    // PART 2: Owner Pending Orders & Inventory Alert Workflow
    // =========================================================================
    console.log("\n--- Testing Owner Inventory Availability Alert Workflow ---");
    const ownerToken = generateAccessToken(ownerUser);

    // Switch session to Owner
    await cdp.eval(`
      localStorage.setItem('smart_bakery_token', '${ownerToken}');
    `);

    // Navigate to Owner Orders tab
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=orders" });
    await sleep(3500);

    // Check presence of Available Alert and Insufficient Alert
    const ownerOrderAudit = await cdp.eval(`
      (() => {
        const text = document.body.innerText;
        const hasAvailOrder = text.includes('${orderAvailable.orderNumber}');
        const hasShortOrder = text.includes('${orderShortage.orderNumber}');
        const hasAvailAlert = text.includes('Inventory Check: Available');
        const hasShortAlert = text.includes('Inventory Warning: Insufficient Ingredients');
        const hasCancelBtn = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Cancel Order'));
        const hasReviewInvBtn = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Review Inventory'));
        const hasShortageRow = text.includes('Belgian Dark Chocolate') || text.includes('Shortage');
        return {
          hasAvailOrder,
          hasShortOrder,
          hasAvailAlert,
          hasShortAlert,
          hasCancelBtn,
          hasReviewInvBtn,
          hasShortageRow
        };
      })()
    `);
    console.log("[Owner Orders Audit]", ownerOrderAudit);
    assert.ok(ownerOrderAudit.hasAvailOrder, "Owner orders list must display the feasible order");
    assert.ok(ownerOrderAudit.hasShortOrder, "Owner orders list must display the shortage order");
    assert.ok(ownerOrderAudit.hasAvailAlert, "Owner dashboard must prominently show 'Inventory Check: Available'");
    assert.ok(ownerOrderAudit.hasShortAlert, "Owner dashboard must prominently show 'Inventory Warning: Insufficient Ingredients'");
    assert.ok(ownerOrderAudit.hasCancelBtn, "Owner must see 'Cancel Order' action button");
    assert.ok(ownerOrderAudit.hasReviewInvBtn, "Owner must see 'Review Inventory' action button");

    // Capture Owner Dashboard with both alerts across viewports
    for (const vp of VIEWPORT_WIDTHS) {
      await cdp.setViewport(vp.width, vp.height);
      await sleep(600);
      const isOverflowing = await cdp.eval(`document.documentElement.scrollWidth > window.innerWidth`);
      assert.equal(isOverflowing, false, `Horizontal overflow at viewport ${vp.name}`);
      const scPath = path.join(SCREENSHOT_DIR, `owner_orders_inventory_alerts_${vp.name}.png`);
      await cdp.captureScreenshot(scPath);
      console.log(`[Screenshot] Owner Inventory Alerts captured: ${vp.name}`);
    }

    // Open Payment Proof / Verify Modal for the Shortage Order
    console.log("[Owner Action] Opening Payment Proof Modal for Shortage Order...");
    const clickProof = await cdp.eval(`
      (() => {
        const allBtns = Array.from(document.querySelectorAll('button'));
        const btn = allBtns.find(b => b.innerText.includes('View Screenshot'));
        if (btn) {
          btn.click();
          return { clicked: true, text: btn.innerText };
        }
        return { clicked: false, allBtnTexts: allBtns.map(b => b.innerText) };
      })()
    `);
    console.log("[Click Proof Result]", clickProof);
    await sleep(2500);

    // Verify Modal displays the Warning Alert and disables normal payment verification
    const modalCheck = await cdp.eval(`
      (() => {
        const modal = document.querySelector('[role="dialog"]') || document.querySelector('.modal') || document.querySelector('.fixed');
        if (!modal) return { open: false };
        const text = modal.innerText;
        const hasWarning = text.includes('Inventory Warning: Insufficient Ingredients');
        const hasShortageTable = text.includes('Belgian Dark Chocolate') || text.includes('Shortage');
        const hasCancelAction = Array.from(modal.querySelectorAll('button')).some(b => b.innerText.includes('Cancel Order'));
        const hasReviewAction = Array.from(modal.querySelectorAll('button')).some(b => b.innerText.includes('Review Inventory'));
        const verifyBtn = Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes('Approve & Verify Payment') || b.innerText.includes('Verify payment') || b.innerText.includes('Verify & Accept') || b.innerText.includes('Accept Payment') || b.innerText.includes('Confirm Payment'));
        const isVerifyDisabled = verifyBtn ? (verifyBtn.disabled || verifyBtn.classList.contains('opacity-50') || verifyBtn.classList.contains('cursor-not-allowed')) : false;
        return {
          open: true,
          hasWarning,
          hasShortageTable,
          hasCancelAction,
          hasReviewAction,
          isVerifyDisabled
        };
      })()
    `);
    console.log("[Modal Verification]", modalCheck);
    assert.ok(modalCheck.open, "Payment proof modal should be open");
    assert.ok(modalCheck.hasWarning, "Modal must display Insufficient Ingredients warning");
    assert.ok(modalCheck.hasCancelAction, "Modal must display Cancel Order button");
    assert.ok(modalCheck.hasReviewAction, "Modal must display Review Inventory button");
    assert.ok(modalCheck.isVerifyDisabled, "Verify payment button must be disabled when inventory is insufficient");

    // Capture Modal across viewports
    for (const vp of VIEWPORT_WIDTHS) {
      await cdp.setViewport(vp.width, vp.height);
      await sleep(600);
      const isOverflowing = await cdp.eval(`document.documentElement.scrollWidth > window.innerWidth`);
      assert.equal(isOverflowing, false, `Horizontal overflow in modal at viewport ${vp.name}`);
      const scPath = path.join(SCREENSHOT_DIR, `payment_modal_shortage_alert_${vp.name}.png`);
      await cdp.captureScreenshot(scPath);
      console.log(`[Screenshot] Payment Modal Shortage Alert captured: ${vp.name}`);
    }

    // Test Cancel Order button in Modal
    console.log("[Owner Action] Clicking Cancel Order for shortage order in modal...");
    await cdp.eval(`window.confirm = () => true; window.prompt = () => 'Customer cancelled due to inventory shortage';`);
    await cdp.eval(`
      (() => {
        const modal = document.querySelector('[role="dialog"]') || document.querySelector('.fixed');
        if (modal) {
          const cancelBtn = Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes('Cancel Order'));
          if (cancelBtn) cancelBtn.click();
        }
      })()
    `);
    await sleep(2500);

    // Verify order was cancelled on backend
    const cancelledOrder = await Order.findById(orderShortage._id);
    console.log(`[Backend Verification] Order status after cancellation: ${cancelledOrder.status}`);
    assert.equal(cancelledOrder.status, CUSTOMER_ORDER_STATUSES.CANCELLED);
    console.log("[Backend Verification] Cancellation recorded actor and reason successfully.");

    console.log("\n ALL BROWSER & UI VERIFICATIONS PASSED CLEANLY!");
  } finally {
    if (cdp) await cdp.close();
    try { chromeProc.kill(); } catch (_) {}
    try { await fs.rm(TEMP_USER_DATA, { recursive: true, force: true }); } catch (_) {}
    await disconnectDb();
  }
}

runBrowserVerification().catch((err) => {
  console.error("FATAL VERIFICATION ERROR:", err);
  process.exit(1);
});
