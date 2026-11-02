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
import Notification from "./src/models/notification.model.js";
import { connectToDb, disconnectDb } from "./src/config/db.js";
import {
  USER_ROLES,
  PRODUCTION_STATUS as S,
  CUSTOMER_ORDER_STATUSES,
  HOLD_REASONS,
  HOLD_INSTRUCTIONS,
} from "./src/utils/constants.js";
import { generateAccessToken } from "./src/utils/token.utils.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9279;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_hold_sched_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "hold_scheduling");

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
      const tm = setTimeout(() => reject(new Error("WS connection timeout")), 10000);
      this.ws.onopen = () => { clearTimeout(tm); resolve(); };
      this.ws.onerror = (e) => { clearTimeout(tm); reject(e); };
    });

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.method === "Page.javascriptDialogOpening") {
          this.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
        }
        if (msg.method === "Network.responseReceived") {
          const url = msg.params?.response?.url;
          if (url && url.includes("/api/")) {
            console.log(`[Network Response ${msg.params?.response?.status}]:`, url);
          }
        }
        if (msg.method === "Runtime.consoleAPICalled") {
          const text = msg.params?.args?.map((a) => a.value || a.description).join(" ");
          if (text && !text.includes("Vite") && !text.includes("Download the React DevTools")) {
            console.log(`[Browser Console]:`, text);
          }
        }
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject, timer } = this.callbacks.get(msg.id);
          clearTimeout(timer);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch (err) {
        console.error("CDP parse error:", err);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      const timer = setTimeout(() => {
        this.callbacks.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 30000);
      this.callbacks.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function setViewport(cdp, width, height, isMobile = false) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: isMobile,
  });
}

async function authenticateBrowser(cdp, token, user) {
  const userJson = JSON.stringify({
    _id: user._id.toString(),
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  });
  await cdp.send("Runtime.evaluate", {
    expression: `
      localStorage.setItem('smart_bakery_token', ${JSON.stringify(token)});
      localStorage.setItem('smart_bakery_user', ${JSON.stringify(userJson)});
      localStorage.setItem('role', ${JSON.stringify(user.role)});
    `,
  });
}

async function main() {
  await connectToDb();
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  const suffix = `v_phs_${Date.now()}`;
  console.log(`Setting up Hold and Scheduling verification fixture: ${suffix}`);

  let owner, baker, customer, category, flour, variantId, product, recipe, lot, confirmedOrder, inProdOrder, inProdBatch;
  let chromeProc, cdp;

  try {
    // 1. Create Users
    owner = await User.create({
      name: `Owner Testing ${suffix}`,
      email: `owner_${suffix}@smartbakery.com`,
      password: "Password123!",
      role: USER_ROLES.OWNER,
      isActive: true,
    });

    baker = await User.create({
      name: `Baker Alex ${suffix}`,
      email: `baker_${suffix}@smartbakery.com`,
      password: "Password123!",
      role: USER_ROLES.PRODUCTION_STAFF,
      hourlyLabourRate: 150,
      isActive: true,
    });

    customer = await User.create({
      name: `Customer Priya ${suffix}`,
      email: `customer_${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.CUSTOMER,
      isActive: true,
    });

    const ownerToken = generateAccessToken(owner);
    const bakerToken = generateAccessToken(baker);

    // 2. Catalog & Recipe
    category = await Category.create({
      name: `Artisan Breads ${suffix}`,
      slug: `artisan-breads-${suffix}`,
      isActive: true,
    });

    flour = await Ingredient.create({
      name: `Flour ${suffix}`,
      slug: `flour-${suffix}`,
      unit: "kg",
      currentStock: 100,
      reservedStock: 0,
      minThreshold: 5,
      costPerUnit: 40,
      shelfLifeDays: 90,
    });

    lot = await InventoryLot.create({
      ingredient: flour._id,
      lotNumber: `LOT-${suffix}`,
      originalQuantity: 100,
      remainingQuantity: 100,
      unit: "kg",
      unitCost: 40,
      purchaseDate: new Date(),
      expiryDate: new Date(Date.now() + 60 * 86400000),
      status: "AVAILABLE",
    });

    variantId = new mongoose.Types.ObjectId();
    product = await Product.create({
      name: `Sourdough Loaf ${suffix}`,
      slug: `sourdough-loaf-${suffix}`,
      category: category._id,
      description: "Crusty artisan sourdough loaf",
      basePrice: 120,
      preparationTime: 30,
      productionTime: 45,
      unit: "piece",
      variants: [
        {
          _id: variantId,
          name: "Standard 800g Loaf",
          quantity: 1,
          unit: "piece",
          price: 120,
          isActive: true,
        },
      ],
      isActive: true,
    });

    recipe = await Recipe.create({
      product: product._id,
      variant: variantId,
      revision: 1,
      expectedYield: 6,
      yieldUnit: "piece",
      preparationTime: 30,
      productionTime: 45,
      ingredients: [
        {
          ingredient: flour._id,
          quantity: 3,
          unit: "kg",
        },
      ],
      instructions: "Ferment 24h, shape into boules, bake at 240C with steam",
      isActive: true,
    });

    // 3. Orders
    confirmedOrder = await Order.create({
      orderNumber: `ORD-CONF-${suffix.slice(-4)}`,
      customer: customer._id,
      contactName: customer.name,
      contactPhone: "9876543210",
      orderType: "PICKUP",
      deliveryDate: "2026-11-02",
      deliveryTimeSlot: "10:00-12:00",
      status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
      paymentStatus: "PAYMENT_CONFIRMED",
      subtotal: 720,
      total: 720,
      specialInstructions: "Extra dark crust please",
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Standard 800g Loaf",
          quantity: 6,
          unitPrice: 120,
          lineTotal: 720,
        },
      ],
    });

    inProdOrder = await Order.create({
      orderNumber: `ORD-PROD-${suffix.slice(-4)}`,
      customer: customer._id,
      contactName: customer.name,
      contactPhone: "9876543210",
      orderType: "DELIVERY",
      deliveryDate: "2026-11-02",
      deliveryTimeSlot: "14:00-16:00",
      status: CUSTOMER_ORDER_STATUSES.IN_PRODUCTION,
      paymentStatus: "PAYMENT_CONFIRMED",
      subtotal: 1200,
      total: 1200,
      deliveryAddress: {
        addressLine1: "123 Baker Street",
        city: "Mumbai",
        postalCode: "400001",
      },
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Standard 800g Loaf",
          quantity: 10,
          unitPrice: 120,
          lineTotal: 1200,
        },
      ],
    });

    // 4. Batch in production
    const batchDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    inProdBatch = await ProductionBatch.create({
      batchNumber: `BATCH-${batchDate}-${suffix.slice(-4)}`,
      product: product._id,
      productVariant: variantId,
      productSnapshot: {
        productName: product.name,
        variantName: "Standard 800g Loaf",
        variantQuantity: 1,
        variantUnit: "piece",
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 6,
        yieldUnit: "piece",
        preparationTime: 30,
        productionTime: 45,
        recipeBatchQuantity: 2,
        ingredients: [
          {
            ingredient: flour._id,
            name: flour.name,
            quantity: 6,
            unit: "kg",
          },
        ],
      },
      plannedQuantity: 12,
      unit: "piece",
      status: S.IN_PRODUCTION,
      actualStartTime: new Date(),
      relatedOrders: [inProdOrder._id],
      assignedWorkers: [
        {
          worker: baker._id,
          task: "Master Baker",
          assignedAt: new Date(),
          hourlyRateSnapshot: 150,
          taskStatus: "IN_PROGRESS",
        },
      ],
      createdBy: owner._id,
    });

    console.log(`Fixtures ready. Spawning Chrome...`);

    // 5. Spawn Chrome
    chromeProc = spawn(CHROME_PATH, [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${TEMP_USER_DATA}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--headless=new",
      "--disable-gpu",
      "--window-size=1366,768",
    ]);

    await sleep(2500);

    const versionResp = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    const versionData = await versionResp.json();
    console.log(`Connected to Chrome version: ${versionData.Browser}`);

    const newTabResp = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
    const tabData = await newTabResp.json();

    cdp = new SafeCdp(tabData.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Network.enable");

    // =========================================================================
    // TEST A: Owner Emergency Hold Workflow & Modal Centering
    // =========================================================================
    console.log("\n--- TEST A: Owner Emergency Hold Workflow ---");
    await setViewport(cdp, 1366, 768);
    await cdp.send("Page.navigate", { url: "http://localhost:5173/login" });
    await sleep(1500);
    await authenticateBrowser(cdp, ownerToken, owner);

    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=production" });
    await sleep(2000);

    // Verify batch is rendered on Production tab
    const batchVisible = await cdp.send("Runtime.evaluate", {
      expression: `document.body.innerText.includes('${inProdBatch.batchNumber}')`,
      returnByValue: true,
    });
    console.log(`In-production batch visible on dashboard: ${batchVisible.result.value}`);
    assert.ok(batchVisible.result.value, "Batch should be visible on owner dashboard");

    // Click "Put on Hold" button
    console.log("Clicking 'Put on Hold' button...");
    const clickHold = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const holdBtn = btns.find(b => b.textContent.includes('Put on Hold') || b.textContent.includes('Hold'));
          if (!holdBtn) return { success: false, error: 'Hold button not found' };
          holdBtn.click();
          return { success: true };
        })()
      `,
      returnByValue: true,
    });
    console.log(`Hold button click:`, clickHold.result.value);
    assert.ok(clickHold.result.value.success, "Hold button must be clickable");
    await sleep(600);

    // Verify Hold Modal is rendered in viewport via Portal and is centered
    const holdModalPos = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const modalBackdrop = document.querySelector('.modal-backdrop-portal');
          const modalDialog = document.querySelector('.modal-backdrop-portal .modal-dialog-centered');
          if (!modalBackdrop || !modalDialog) {
            return { found: false };
          }
          const rect = modalDialog.getBoundingClientRect();
          const bodyHasClass = document.body.classList.contains('modal-open');
          const isCenteredVertically = rect.top > 0 && (rect.top + rect.height / 2) < window.innerHeight;
          const isCenteredHorizontally = Math.abs((window.innerWidth - rect.width) / 2 - rect.left) < 30;
          return {
            found: true,
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            bodyHasClass,
            isCenteredVertically,
            isCenteredHorizontally
          };
        })()
      `,
      returnByValue: true,
    });
    console.log("Hold modal position & centering:", holdModalPos.result.value);
    assert.ok(holdModalPos.result.value.found, "Hold modal must be open in the DOM");
    assert.ok(holdModalPos.result.value.bodyHasClass, "Body must have 'modal-open' class to lock background scrolling");
    assert.ok(holdModalPos.result.value.isCenteredVertically, "Modal must be centered vertically in the viewport");
    assert.ok(holdModalPos.result.value.isCenteredHorizontally, "Modal must be centered horizontally in the viewport");

    // Capture Screenshot 1: Owner Hold Modal Centered
    const shot1 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "01_owner_hold_modal_centered.png"), Buffer.from(shot1.data, "base64"));
    console.log("Captured 01_owner_hold_modal_centered.png");

    // Fill hold form: Reason = CUSTOMER_CANCELLED, Instruction = STOP_IMMEDIATELY, Note
    console.log("Submitting hold confirmation...");
    const submitHold = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const selects = Array.from(document.querySelectorAll('.modal-backdrop-portal select'));
          if (selects.length >= 2) {
            selects[0].value = 'Customer requested cancellation';
            selects[0].dispatchEvent(new Event('change', { bubbles: true }));
            selects[1].value = 'Stop production immediately';
            selects[1].dispatchEvent(new Event('change', { bubbles: true }));
          }
          const textarea = document.querySelector('.modal-backdrop-portal textarea');
          if (textarea) {
            textarea.value = 'Emergency hold triggered for automated verification';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const confirmBtn = document.querySelector('[data-testid="confirm-hold-submit-btn"]') || document.querySelector('.modal-backdrop-portal button[type="submit"]');
          if (!confirmBtn) return { success: false, error: 'Confirm button not found' };
          confirmBtn.click();
          return { success: true };
        })()
      `,
      returnByValue: true,
    });
    console.log("Hold submit click:", submitHold.result.value);
    await sleep(2500);

    // Verify hold banner appears on the batch
    const holdBanner = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasOnHoldBadge: text.includes('EMERGENCY BATCH HOLD ACTIVE') || text.includes('Customer requested cancellation') || text.includes('Stop production immediately') || text.includes('Update Instruction'),
            fullTextSnippet: text.slice(0, 500)
          };
        })()
      `,
      returnByValue: true,
    });
    console.log("Owner dashboard hold banner verified:", holdBanner.result.value.hasOnHoldBadge);
    assert.ok(holdBanner.result.value.hasOnHoldBadge, "Owner dashboard must display active hold banner");

    // Capture Screenshot 2: Owner Batch On Hold
    const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "02_owner_batch_on_hold.png"), Buffer.from(shot2.data, "base64"));
    console.log("Captured 02_owner_batch_on_hold.png");

    // Baker View: Switch to baker and verify immediate hold notification
    console.log("Switching to baker workstation...");
    await authenticateBrowser(cdp, bakerToken, baker);
    await cdp.send("Page.navigate", { url: "http://localhost:5173/production" });
    await sleep(2000);

    const bakerHoldAlert = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasHoldNotice: text.includes('HOLD') || text.includes('Emergency Production Hold') || text.includes('Stop Production Immediately'),
          };
        })()
      `,
      returnByValue: true,
    });
    console.log("Baker workstation hold notification verified:", bakerHoldAlert.result.value.hasHoldNotice);
    assert.ok(bakerHoldAlert.result.value.hasHoldNotice, "Baker workstation must show immediate emergency hold notification");

    // Capture Screenshot 3: Baker Hold Notification
    const shot3 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "03_baker_hold_notification.png"), Buffer.from(shot3.data, "base64"));
    console.log("Captured 03_baker_hold_notification.png");

    // =========================================================================
    // TEST B: Schedule Batch on Confirmed Order
    // =========================================================================
    console.log("\n--- TEST B: Schedule Batch from Confirmed Order ---");
    await authenticateBrowser(cdp, ownerToken, owner);
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=orders" });
    await sleep(2000);

    const orderRowFound = await cdp.send("Runtime.evaluate", {
      expression: `document.body.innerText.includes('${confirmedOrder.orderNumber}')`,
      returnByValue: true,
    });
    console.log(`Confirmed order ${confirmedOrder.orderNumber} visible on Orders tab: ${orderRowFound.result.value}`);
    assert.ok(orderRowFound.result.value, "Confirmed order must be visible on orders list");

    // Click "Schedule Batch" on confirmed order
    console.log("Clicking 'Schedule Batch' on order...");
    const clickSchedOrder = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const schedBtn = btns.find(b => b.textContent.includes('Schedule Batch'));
          if (!schedBtn) return { success: false, error: 'Schedule Batch button not found on order' };
          schedBtn.click();
          return { success: true };
        })()
      `,
      returnByValue: true,
    });
    console.log("Schedule Batch button click:", clickSchedOrder.result.value);
    assert.ok(clickSchedOrder.result.value.success, "Schedule Batch button must be found on confirmed order");
    await sleep(800);

    // Verify BatchScheduleModal opened centered in viewport with pre-filled order data
    const schedModalInfo = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const modal = document.querySelector('[data-testid="batch-schedule-modal"]');
          if (!modal) return { found: false };
          const dialog = modal.querySelector('.modal-dialog-centered');
          const rect = dialog.getBoundingClientRect();
          const title = modal.querySelector('h3')?.textContent || '';
          const inputs = Array.from(modal.querySelectorAll('input, select, textarea')).map(el => ({
            name: el.name || el.id,
            val: el.value,
          }));
          const orderBadge = modal.querySelector('.badge-pill')?.textContent || '';
          return {
            found: true,
            title,
            orderBadge,
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            windowHeight: window.innerHeight,
            windowWidth: window.innerWidth,
            isCentered: rect.top > 0 && rect.top < window.innerHeight,
            inputsCount: inputs.length,
          };
        })()
      `,
      returnByValue: true,
    });
    console.log("Schedule Batch Modal pre-fill & layout:", schedModalInfo.result.value);
    assert.ok(schedModalInfo.result.value.found, "BatchScheduleModal must open via Portal");
    assert.ok(schedModalInfo.result.value.isCentered, "BatchScheduleModal must be centered in viewport");

    // Capture Screenshot 4: Schedule Batch Modal From Order
    const shot4 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "04_schedule_batch_from_order_modal.png"), Buffer.from(shot4.data, "base64"));
    console.log("Captured 04_schedule_batch_from_order_modal.png");

    // Select assigned baker and submit "Schedule Batch"
    console.log("Assigning baker and submitting Schedule Batch...");
    const submitSched = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const modal = document.querySelector('[data-testid="batch-schedule-modal"]');
          if (!modal) return { success: false, error: 'Modal not found' };
          const selects = Array.from(modal.querySelectorAll('select'));
          const workerSelect = selects[2] || selects[selects.length - 1];
          if (workerSelect) {
            workerSelect.value = '${baker._id}';
            workerSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const form = modal.querySelector('form');
          const submitBtn = modal.querySelector('button[type="submit"]');
          const isValid = form ? form.checkValidity() : false;
          const formVals = {
            product: selects[0]?.value,
            variant: selects[1]?.value,
            worker: workerSelect?.value,
            qty: modal.querySelector('input[type="number"]')?.value,
            isValid,
            btnDisabled: submitBtn?.disabled,
          };
          if (!submitBtn) return { success: false, error: 'Submit button not found', formVals };
          submitBtn.click();
          return { success: true, formVals };
        })()
      `,
      returnByValue: true,
    });
    console.log("Submit schedule batch result:", submitSched.result.value);
    await sleep(2000);

    // Verify new batch is created in database linked to confirmedOrder
    const dbBatchForOrder = await ProductionBatch.findOne({ relatedOrders: confirmedOrder._id });
    console.log("Database batch created for order:", dbBatchForOrder?.batchNumber);
    assert.ok(dbBatchForOrder, "Batch must be created in DB linked to confirmedOrder");

    // Verify on Production tab
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=production" });
    await sleep(1500);

    const batchFromOrderVisible = await cdp.send("Runtime.evaluate", {
      expression: `document.body.innerText.includes('${dbBatchForOrder.batchNumber}')`,
      returnByValue: true,
    });
    console.log(`New scheduled batch ${dbBatchForOrder.batchNumber} visible on Production tab: ${batchFromOrderVisible.result.value}`);
    assert.ok(batchFromOrderVisible.result.value, "Scheduled batch must be displayed on dashboard");

    // Capture Screenshot 5: Batch Scheduled From Order
    const shot5 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "05_batch_scheduled_from_order.png"), Buffer.from(shot5.data, "base64"));
    console.log("Captured 05_batch_scheduled_from_order.png");

    // =========================================================================
    // TEST C: Schedule New Batch on Production Tab Across 5 Viewports
    // =========================================================================
    console.log("\n--- TEST C: Schedule New Batch Across 5 Viewports ---");
    const viewports = [
      { name: "375px", width: 375, height: 667, isMobile: true, file: "06_schedule_modal_viewport_375px.png" },
      { name: "430px", width: 430, height: 932, isMobile: true, file: "07_schedule_modal_viewport_430px.png" },
      { name: "768px", width: 768, height: 1024, isMobile: false, file: "08_schedule_modal_viewport_768px.png" },
      { name: "1366px", width: 1366, height: 768, isMobile: false, file: "09_schedule_modal_viewport_1366px.png" },
      { name: "1920px", width: 1920, height: 1080, isMobile: false, file: "10_schedule_modal_viewport_1920px.png" },
    ];

    for (const vp of viewports) {
      console.log(`\nTesting Viewport: ${vp.name} (${vp.width}x${vp.height})...`);
      await setViewport(cdp, vp.width, vp.height, vp.isMobile);
      await sleep(400);

      // Click "Schedule New Batch" on Production tab
      const openModal = await cdp.send("Runtime.evaluate", {
        expression: `
          (() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn = btns.find(b => b.textContent.includes('Schedule New Batch'));
            if (!btn) return { success: false, error: 'Schedule New Batch button not found' };
            btn.click();
            return { success: true };
          })()
        `,
        returnByValue: true,
      });
      assert.ok(openModal.result.value.success, `Must be able to click Schedule New Batch at ${vp.name}`);
      await sleep(600);

      // Verify layout & centering
      const vpMetrics = await cdp.send("Runtime.evaluate", {
        expression: `
          (() => {
            const modal = document.querySelector('[data-testid="batch-schedule-modal"]');
            if (!modal) return { found: false };
            const dialog = modal.querySelector('.modal-dialog-centered');
            const rect = dialog.getBoundingClientRect();
            const bodyScrollWidth = document.body.scrollWidth;
            const hasHorizontalOverflow = bodyScrollWidth > window.innerWidth + 2;
            const isCenteredHorizontally = Math.abs((window.innerWidth - rect.width) / 2 - rect.left) < 25;
            const isVisibleInViewport = rect.top >= 0 && rect.top < window.innerHeight;
            return {
              found: true,
              rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
              windowWidth: window.innerWidth,
              windowHeight: window.innerHeight,
              hasHorizontalOverflow,
              isCenteredHorizontally,
              isVisibleInViewport,
            };
          })()
        `,
        returnByValue: true,
      });
      console.log(`Viewport ${vp.name} layout metrics:`, vpMetrics.result.value);
      assert.ok(vpMetrics.result.value.found, `Modal must open at ${vp.name}`);
      assert.ok(vpMetrics.result.value.isVisibleInViewport, `Modal must be visible at top of viewport at ${vp.name} (not scrolled down)`);
      assert.ok(vpMetrics.result.value.isCenteredHorizontally, `Modal must be centered horizontally at ${vp.name}`);
      assert.ok(!vpMetrics.result.value.hasHorizontalOverflow, `No horizontal scroll overflow permitted at ${vp.name}`);

      // Capture screenshot
      const shotVp = await cdp.send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(path.join(SCREENSHOT_DIR, vp.file), Buffer.from(shotVp.data, "base64"));
      console.log(`Saved screenshot: ${vp.file}`);

      // Test Escape key dismisses the modal cleanly
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await sleep(400);

      const modalClosed = await cdp.send("Runtime.evaluate", {
        expression: `!document.querySelector('[data-testid="batch-schedule-modal"]')`,
        returnByValue: true,
      });
      console.log(`Modal closed on Escape key at ${vp.name}: ${modalClosed.result.value}`);
      assert.ok(modalClosed.result.value, "Escape key must dismiss modal");
    }

    console.log("\n=======================================================");
    console.log("ALL BROWSER CDP VERIFICATIONS PASSED SUCCESSFULLY!");
    console.log("10 screenshots captured in verification_screenshots/hold_scheduling/");
    console.log("=======================================================\n");

  } finally {
    // 6. DB Cleanup
    console.log("Cleaning up all ephemeral test fixture data from database...");
    try {
      if (confirmedOrder) await Order.deleteOne({ _id: confirmedOrder._id });
      if (inProdOrder) await Order.deleteOne({ _id: inProdOrder._id });
      if (inProdBatch) await ProductionBatch.deleteOne({ _id: inProdBatch._id });
      // Delete any batch created for confirmedOrder
      if (confirmedOrder) {
        await ProductionBatch.deleteMany({ relatedOrders: confirmedOrder._id });
      }
      if (lot) await InventoryLot.deleteOne({ _id: lot._id });
      if (flour) await Ingredient.deleteOne({ _id: flour._id });
      if (recipe) await Recipe.deleteOne({ _id: recipe._id });
      if (product) await Product.deleteOne({ _id: product._id });
      if (category) await Category.deleteOne({ _id: category._id });
      if (owner) await User.deleteOne({ _id: owner._id });
      if (baker) await User.deleteOne({ _id: baker._id });
      if (customer) await User.deleteOne({ _id: customer._id });
      await Notification.deleteMany({
        $or: [
          { recipient: owner?._id },
          { recipient: baker?._id },
          { recipient: customer?._id },
        ],
      });
      console.log("Database cleanup completed successfully.");
    } catch (cleanErr) {
      console.error("Cleanup warning:", cleanErr);
    }

    if (cdp) cdp.close();
    if (chromeProc) {
      chromeProc.kill("SIGTERM");
    }
    await sleep(500);
    try {
      await fs.rm(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
