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
  HOLD_RESOLUTIONS,
} from "./src/utils/constants.js";
import { generateAccessToken } from "./src/utils/token.utils.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9269;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_hold_browser_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "emergency_production_hold");

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
        if (msg.method === "Network.loadingFailed") {
          console.log(`[Network FAILED]:`, msg.params?.errorText, msg.params?.canceled);
        }
        if (msg.method === "Network.requestWillBeSent") {
          const url = msg.params?.request?.url;
          if (url && url.includes("/api/")) {
            console.log(`[Network ${msg.params?.request?.method}]:`, url);
          }
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

  const suffix = `eph_ui_${Date.now()}`;
  console.log(`Setting up Emergency Production Hold fixture: ${suffix}`);

  let owner, baker, customer, category, flour, variantId, product, recipe, lot, order1, order2, batch;
  let chromeProc, cdp;

  try {
    // 1. Setup Users
    owner = await User.create({
      name: `Owner Sarah ${suffix}`,
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
      isActive: true,
    });

    customer = await User.create({
      name: `Customer Emma ${suffix}`,
      email: `customer_${suffix}@test.com`,
      password: "Password123!",
      role: USER_ROLES.CUSTOMER,
      isActive: true,
    });

    const ownerToken = generateAccessToken(owner);
    const bakerToken = generateAccessToken(baker);

    // 2. Setup Catalog & Inventory
    category = await Category.create({
      name: `Artisan Pastries ${suffix}`,
      slug: `artisan-pastries-${suffix}`,
      isActive: true,
    });

    flour = await Ingredient.create({
      name: `Organic Pastry Flour ${suffix}`,
      slug: `organic-flour-${suffix}`,
      unit: "kg",
      currentStock: 100,
      reservedStock: 0,
      minThreshold: 5,
      costPerUnit: 45,
      shelfLifeDays: 90,
    });

    lot = await InventoryLot.create({
      ingredient: flour._id,
      lotNumber: `LOT-FLOUR-${suffix}`,
      originalQuantity: 100,
      remainingQuantity: 100,
      unit: "kg",
      unitCost: 45,
      purchaseDate: new Date(),
      expiryDate: new Date(Date.now() + 60 * 86400000),
      status: "AVAILABLE",
    });

    variantId = new mongoose.Types.ObjectId();
    product = await Product.create({
      name: `Chocolate Brioche ${suffix}`,
      slug: `chocolate-brioche-${suffix}`,
      category: category._id,
      description: "Rich buttery chocolate brioche rolls",
      basePrice: 60,
      preparationTime: 20,
      productionTime: 25,
      unit: "piece",
      variants: [
        {
          _id: variantId,
          name: "Box of 4 Brioches",
          quantity: 4,
          unit: "piece",
          price: 240,
          isActive: true,
        },
      ],
      isActive: true,
    });

    recipe = await Recipe.create({
      product: product._id,
      variant: variantId,
      revision: 1,
      expectedYield: 4,
      yieldUnit: "piece",
      preparationTime: 20,
      productionTime: 25,
      ingredients: [
        {
          ingredient: flour._id,
          quantity: 0.5,
          unit: "kg",
        },
      ],
      instructions: "Knead enriched dough, shape brioches, egg wash, and bake at 190C for 22 mins",
      isActive: true,
    });

    // 3. Create Orders
    order1 = await Order.create({
      orderNumber: `ORD-EPH-1-${suffix.slice(-4)}`,
      customer: customer._id,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Box of 4 Brioches",
          quantity: 1,
          unitPrice: 240,
          lineTotal: 240,
          specialInstructions: "Customer Emma: Well baked, extra golden",
        },
      ],
      subtotal: 240,
      total: 240,
      orderType: "DELIVERY",
      deliveryDate: "2026-11-02",
      deliveryTimeSlot: "10:00-12:00",
      contactName: "Emma Davis",
      contactPhone: "9876543210",
      deliveryAddress: {
        addressLine1: "42 Baker Street",
        city: "Mumbai",
        postalCode: "400001",
      },
      status: CUSTOMER_ORDER_STATUSES.IN_PRODUCTION,
      paymentStatus: "PAYMENT_CONFIRMED",
    });

    order2 = await Order.create({
      orderNumber: `ORD-EPH-2-${suffix.slice(-4)}`,
      customer: customer._id,
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          variantName: "Box of 4 Brioches",
          quantity: 1,
          unitPrice: 240,
          lineTotal: 240,
          specialInstructions: "Customer Noah: Standard bake",
        },
      ],
      subtotal: 240,
      total: 240,
      orderType: "PICKUP",
      deliveryDate: "2026-11-02",
      deliveryTimeSlot: "14:00-16:00",
      contactName: "Noah Smith",
      contactPhone: "9876543211",
      status: CUSTOMER_ORDER_STATUSES.IN_PRODUCTION,
      paymentStatus: "PAYMENT_CONFIRMED",
    });

    // 4. Create Production Batch in IN_PRODUCTION status
    batch = await ProductionBatch.create({
      batchNumber: `BATCH-EPH-${suffix.slice(-4)}`,
      product: product._id,
      productVariant: variantId,
      productSnapshot: {
        productName: product.name,
        variantName: "Box of 4 Brioches",
        variantQuantity: 4,
        variantUnit: "piece",
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 4,
        yieldUnit: "piece",
        recipeBatchQuantity: 2,
        ingredients: [{ ingredient: flour._id, name: flour.name, quantity: 1, unit: "kg" }],
      },
      plannedQuantity: 8,
      unit: "piece",
      status: S.IN_PRODUCTION,
      verificationStatus: "VERIFIED",
      verifiedBy: baker._id,
      verifiedAt: new Date(),
      bakingStartTime: new Date(),
      actualStartTime: new Date(),
      consumptionStatus: "CONSUMED",
      consumedIngredients: [
        {
          ingredient: flour._id,
          ingredientName: flour.name,
          lot: lot._id,
          lotNumber: lot.lotNumber,
          quantity: 1,
          unit: "kg",
          unitCost: 45,
          totalCost: 45,
        },
      ],
      relatedOrders: [order1._id, order2._id],
      assignedWorkers: [{ worker: baker._id, task: "Bake Chocolate Brioche", taskStatus: "IN_PROGRESS" }],
      createdBy: owner._id,
    });

    console.log(`Created Batch: ${batch.batchNumber} (ID: ${batch._id})`);

    // 5. Launch Chrome Headless
    console.log("Launching Headless Chrome on port", PORT);
    chromeProc = spawn(
      CHROME_PATH,
      [
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${TEMP_USER_DATA}`,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1366,768",
        "about:blank",
      ],
      { stdio: "ignore" }
    );

    let wsUrl = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json`);
        if (res.ok) {
          const list = await res.json();
          const pageTarget = list.find((p) => p.type === "page");
          if (pageTarget && pageTarget.webSocketDebuggerUrl) {
            wsUrl = pageTarget.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {}
    }

    if (!wsUrl) throw new Error("Could not connect to Chrome CDP Page target");
    console.log("Connected to Chrome Page WS:", wsUrl);

    cdp = new SafeCdp(wsUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    // ---------------------------------------------------------------------------------
    // STEP A: Owner Dashboard - Emergency Hold Modal & Placement (1366px Desktop)
    // ---------------------------------------------------------------------------------
    console.log("\n--- STEP A: Owner Places Batch on Hold ---");
    await setViewport(cdp, 1366, 768, false);

    // Initial navigation to establish localStorage context
    await cdp.send("Page.navigate", { url: "http://localhost:5173/login" });
    await sleep(2000);
    await authenticateBrowser(cdp, ownerToken, owner);

    // Navigate to Owner Dashboard Production tab
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=production" });
    await sleep(3500);

    // Click "Put on Hold" for this batch
    const holdBtnClicked = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const cards = Array.from(document.querySelectorAll('.production-board-card, .card, div'));
          const targetCard = cards.find(c => c.innerText && c.innerText.includes('${batch.batchNumber}'));
          const container = targetCard || document;
          const btns = Array.from(container.querySelectorAll('button'));
          const holdBtn = btns.find(b => b.innerText && (b.innerText.includes('Put on Hold') || b.innerText.includes('Hold')));
          if (holdBtn) {
            holdBtn.click();
            return true;
          }
          return false;
        })();
      `,
      returnByValue: true,
    });
    console.log("Clicked 'Put on Hold' button in Owner Dashboard:", holdBtnClicked.result.value);
    await sleep(1500);

    // Capture Screenshot 1: Owner Hold Modal
    const shot1 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "01_owner_hold_modal_desktop.png"), Buffer.from(shot1.data, "base64"));
    console.log("Saved: 01_owner_hold_modal_desktop.png");

    // Select Reason, Instruction and submit Hold
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const selects = Array.from(document.querySelectorAll('.modal-content select'));
          if (selects.length >= 2) {
            selects[0].value = 'Customer requested cancellation';
            selects[0].dispatchEvent(new Event('change', { bubbles: true }));
            selects[1].value = 'Stop production immediately';
            selects[1].dispatchEvent(new Event('change', { bubbles: true }));
          }
          const textarea = document.querySelector('.modal-content textarea');
          if (textarea) {
            textarea.value = 'Customer Emma phoned to cancel ORD-EPH-1. Stop production immediately.';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const submitBtn = document.querySelector('.modal-content button[type="submit"]');
          if (submitBtn) submitBtn.click();
        })();
      `,
    });
    await sleep(3000);

    // Verify batch now shows "ON HOLD" in Owner Dashboard
    const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "02_owner_batch_on_hold_desktop.png"), Buffer.from(shot2.data, "base64"));
    console.log("Saved: 02_owner_batch_on_hold_desktop.png");

    // Verify DB state
    const dbBatchHeld = await ProductionBatch.findById(batch._id);
    assert.equal(dbBatchHeld.holdState.isOnHold, true, "Batch must be on hold in database");
    assert.equal(dbBatchHeld.holdState.holdReason, "Customer requested cancellation");
    assert.equal(dbBatchHeld.holdState.holdInstruction, "Stop production immediately");
    console.log("Confirmed: DB Batch is ON HOLD (Stop production immediately)");

    // ---------------------------------------------------------------------------------
    // STEP B: Baker Dashboard - Workstation Emergency Banner & Mobile Viewport (375px)
    // ---------------------------------------------------------------------------------
    console.log("\n--- STEP B: Baker Workstation Receives Emergency Hold ---");

    // Authenticate as Baker
    await authenticateBrowser(cdp, bakerToken, baker);

    // Navigate to Baker Dashboard directly to this batch's workstation
    await cdp.send("Page.navigate", { url: `http://localhost:5173/production?batchId=${batch._id}` });
    await sleep(3500);

    // Capture Screenshot 3: Baker Desktop Viewport (1366px)
    const shot3 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "03_baker_workstation_hold_banner_desktop.png"), Buffer.from(shot3.data, "base64"));
    console.log("Saved: 03_baker_workstation_hold_banner_desktop.png");

    // Capture Screenshot 4: Baker Mobile Viewport (375px)
    console.log("Testing Mobile Viewport (375px x 667px)...");
    await setViewport(cdp, 375, 667, true);
    await sleep(1500);
    const shot4 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "04_baker_workstation_hold_mobile_375px.png"), Buffer.from(shot4.data, "base64"));
    console.log("Saved: 04_baker_workstation_hold_mobile_375px.png");

    // Reset back to desktop viewport
    await setViewport(cdp, 1366, 768, false);
    await sleep(1000);

    // Baker submits Acknowledgement & State Report
    console.log("Baker fills out Acknowledgement form...");
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const inputs = Array.from(document.querySelectorAll('input'));
          const workInput = inputs.find(i => i.placeholder && i.placeholder.includes('currently in oven'));
          if (workInput) {
            workInput.value = 'Dough mixed, shaped, proofed, baked for 10 minutes in deck oven.';
            workInput.dispatchEvent(new Event('input', { bubbles: true }));
          }

          const checkbox = document.querySelector('input[type="checkbox"]');
          if (checkbox && !checkbox.checked) {
            checkbox.click();
          }

          const noteInput = inputs.find(i => i.placeholder && i.placeholder.includes('Oven timer'));
          if (noteInput) {
            noteInput.value = 'Pulled tray out of oven to prevent burning. Production halted.';
            noteInput.dispatchEvent(new Event('input', { bubbles: true }));
          }

          const btns = Array.from(document.querySelectorAll('button'));
          const ackBtn = btns.find(b => b.innerText && b.innerText.includes('Acknowledge Hold & Report Status'));
          if (ackBtn) ackBtn.click();
        })();
      `,
    });
    await sleep(3000);

    // Capture Screenshot 5: Baker Acknowledged State
    const shot5 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "05_baker_acknowledged_state_desktop.png"), Buffer.from(shot5.data, "base64"));
    console.log("Saved: 05_baker_acknowledged_state_desktop.png");

    // Verify DB acknowledgement
    const dbAck = await ProductionBatch.findById(batch._id);
    assert.equal(dbAck.holdState.bakerAcknowledged, true, "Baker must be recorded as acknowledged in DB");
    console.log("Confirmed: DB records Baker Acknowledged = true");

    // ---------------------------------------------------------------------------------
    // STEP C: Owner Updates Instruction to CONTINUE_CURRENT_STEP
    // ---------------------------------------------------------------------------------
    console.log("\n--- STEP C: Owner Updates Hold Instruction ---");
    await authenticateBrowser(cdp, ownerToken, owner);

    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=production" });
    await sleep(3500);

    // Click "Update Instruction"
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const updateBtn = btns.find(b => b.innerText && b.innerText.includes('Update Instruction'));
          if (updateBtn) updateBtn.click();
        })();
      `,
    });
    await sleep(1500);

    // Capture Screenshot 6: Update Instruction Modal
    const shot6 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "06_owner_update_instruction_modal.png"), Buffer.from(shot6.data, "base64"));
    console.log("Saved: 06_owner_update_instruction_modal.png");

    // Select Continue current work temporarily and submit
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const select = document.querySelector('.modal-content select');
          if (select) {
            select.value = 'Continue current work temporarily';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const textarea = document.querySelector('.modal-content textarea');
          if (textarea) {
            textarea.value = 'Finish baking current tray so ingredients are not wasted. Do not package.';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const submitBtn = document.querySelector('.modal-content button[type="submit"]');
          if (submitBtn) submitBtn.click();
        })();
      `,
    });
    await sleep(3000);

    const dbUpdated = await ProductionBatch.findById(batch._id);
    assert.equal(dbUpdated.holdState.holdInstruction, "Continue current work temporarily");
    assert.equal(dbUpdated.holdState.instructionVersion, 2);
    console.log("Confirmed: DB instruction updated to CONTINUE_CURRENT_STEP (version 2)");

    // ---------------------------------------------------------------------------------
    // STEP D: Baker Executes Permitted Step (Record Output)
    // ---------------------------------------------------------------------------------
    console.log("\n--- STEP D: Baker Executes Permitted Step (Record Output) ---");
    await authenticateBrowser(cdp, bakerToken, baker);

    await cdp.send("Page.navigate", { url: `http://localhost:5173/production?batchId=${batch._id}` });
    await sleep(3500);

    // Baker submits output quantity in Stage 4
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          function setReactVal(el, val) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }

          window.alert = (msg) => { console.log("ALERT IN STEP D:", msg); };

          const qtyInput = document.querySelector('input[type="number"]');
          if (qtyInput) setReactVal(qtyInput, '8');

          const remarkInput = Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.includes('nominal yield'));
          if (remarkInput) setReactVal(remarkInput, 'Nominal yield completed under hold permission');

          const recBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Record Output'));
          if (recBtn) recBtn.click();
        })();
      `,
    });
    await sleep(3500);

    // Capture Screenshot 7: Baker Permitted Step Completed
    const shot7 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "07_baker_permitted_step_completed.png"), Buffer.from(shot7.data, "base64"));
    console.log("Saved: 07_baker_permitted_step_completed.png");

    // ---------------------------------------------------------------------------------
    // STEP E: Owner Resolves Hold (Cancelling Order 1, Keeping Order 2 Active)
    // ---------------------------------------------------------------------------------
    console.log("\n--- STEP E: Owner Resolves Hold (Cancels Order 1, Keeps Order 2 Active) ---");
    await authenticateBrowser(cdp, ownerToken, owner);

    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=production" });
    await sleep(3500);

    // Click "Resolve Hold"
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const resBtn = btns.find(b => b.innerText && b.innerText.includes('Resolve Hold'));
          if (resBtn) resBtn.click();
        })();
      `,
    });
    await sleep(1500);

    // Capture Screenshot 8: Resolve Hold Modal
    const shot8 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "08_owner_resolve_hold_modal.png"), Buffer.from(shot8.data, "base64"));
    console.log("Saved: 08_owner_resolve_hold_modal.png");

    // Select 'Confirm Order Cancellation'
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const select = document.querySelector('.modal-content select');
          if (select) {
            select.value = 'Confirm Order Cancellation';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })();
      `,
    });
    await sleep(1000);

    // Select Order 1 to cancel, add resolution note, and submit
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const selects = Array.from(document.querySelectorAll('.modal-content select'));
          if (selects.length > 1) {
            selects[1].value = '${order1._id.toString()}';
            selects[1].dispatchEvent(new Event('change', { bubbles: true }));
          }
          const textarea = document.querySelector('.modal-content textarea');
          if (textarea) {
            textarea.value = 'Cancelled Order 1 per customer request. Keep Order 2 active.';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const submitBtn = document.querySelector('.modal-content button[type="submit"]');
          if (submitBtn) submitBtn.click();
        })();
      `,
    });
    await sleep(3000);

    // Capture Screenshot 9: Owner Order Cancelled, Batch Active
    const shot9 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "09_owner_order_cancelled_batch_active.png"), Buffer.from(shot9.data, "base64"));
    console.log("Saved: 09_owner_order_cancelled_batch_active.png");

    // Verify DB states
    const finalOrder1 = await Order.findById(order1._id);
    const finalOrder2 = await Order.findById(order2._id);
    const resolvedBatch = await ProductionBatch.findById(batch._id);

    assert.equal(finalOrder1.status, CUSTOMER_ORDER_STATUSES.CANCELLED, "Order 1 must be CANCELLED");
    assert.equal(finalOrder2.status, CUSTOMER_ORDER_STATUSES.IN_PRODUCTION, "Order 2 must still be IN_PRODUCTION");
    assert.equal(resolvedBatch.holdState.isOnHold, false, "Batch hold must be cleared");
    console.log("Confirmed: Order 1 is CANCELLED; Order 2 remains IN_PRODUCTION; Batch is UNHELD");

    // ---------------------------------------------------------------------------------
    // STEP F: Baker Finishes Batch for Order 2
    // ---------------------------------------------------------------------------------
    console.log("\n--- STEP F: Baker Completes Batch for Order 2 ---");
    await authenticateBrowser(cdp, bakerToken, baker);

    await cdp.send("Page.navigate", { url: `http://localhost:5173/production?batchId=${batch._id}` });
    await sleep(3500);

    const inspectF = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const form = document.querySelector('form');
          const inputs = Array.from(document.querySelectorAll('input')).map(i => ({ type: i.type, value: i.value, placeholder: i.placeholder, required: i.required }));
          const btns = Array.from(document.querySelectorAll('button')).map(b => ({ text: b.innerText, disabled: b.disabled }));
          return {
            hasForm: !!form,
            inputs,
            btns,
            bodySnippet: document.body.innerText.slice(0, 300)
          };
        })();
      `,
      returnByValue: true,
    });
    console.log("Inspect F state:", JSON.stringify(inspectF.result.value, null, 2));

    // Stage 5: Save Packaging
    const pkgResult = await cdp.send("Runtime.evaluate", {
      expression: `
        (async () => {
          window.__lastAlert = null;
          window.__lastError = null;
          window.alert = (msg) => { window.__lastAlert = msg; console.log("ALERT IN STEP F (PKG):", msg); };
          window.addEventListener('unhandledrejection', (e) => { window.__lastError = e.reason?.message || String(e.reason); });

          if (typeof window.__savePackaging === 'function') {
            await window.__savePackaging();
            return { initiated: true };
          }

          const btns = Array.from(document.querySelectorAll('button'));
          const pkgBtn = btns.find(b => b.innerText && b.innerText.includes('Save Packaging'));
          const selects = Array.from(document.querySelectorAll('select')).map(s => ({ value: s.value }));
          const inputs = Array.from(document.querySelectorAll('input')).map(i => ({ value: i.value, type: i.type }));

          let clickDispatched = false;
          let submitDispatched = false;

          if (pkgBtn) {
            pkgBtn.scrollIntoView();
            pkgBtn.click();
            clickDispatched = true;

            const parentForm = pkgBtn.closest('form');
            if (parentForm) {
              parentForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              submitDispatched = true;
            }
            return {
              clicked: true,
              text: pkgBtn.innerText,
              disabled: pkgBtn.disabled,
              title: pkgBtn.title,
              clickDispatched,
              submitDispatched,
              selects,
              inputs
            };
          }
          return { clicked: false, availableButtons: btns.map(b => b.innerText) };
        })();
      `,
      awaitPromise: true,
      returnByValue: true,
    });
    console.log("Stage 5 Save Packaging click:", JSON.stringify(pkgResult.result.value, null, 2));

    // Wait for Stage 6 "Mark as Complete" to appear
    let markCompleteClicked = false;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const chk = await cdp.send("Runtime.evaluate", {
        expression: `
          (() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const finBtn = btns.find(b => b.innerText && b.innerText.includes('Mark as Complete'));
            if (finBtn) {
              if (typeof window.__markComplete === 'function') {
                window.__markComplete();
                return { clicked: true, text: 'Mark as Complete (Direct)' };
              }
              finBtn.click();
              return { clicked: true, text: finBtn.innerText };
            }
            return {
              clicked: false,
              availableButtons: btns.map(b => b.innerText.trim()).filter(Boolean),
              lastAlert: window.__lastAlert,
              lastError: window.__lastError
            };
          })();
        `,
        returnByValue: true,
      });
      if (chk.result.value?.clicked) {
        console.log("Stage 6 Mark Complete click succeeded:", chk.result.value);
        markCompleteClicked = true;
        break;
      } else {
        const curBatch = await ProductionBatch.findById(batch._id);
        console.log(`Poll ${i}: DB status=${curBatch?.status}, packagingStatus=${curBatch?.packagingStatus}, Alert=${chk.result.value?.lastAlert}, UI buttons:`, chk.result.value?.availableButtons);
      }
    }
    assert(markCompleteClicked, "Stage 6 Mark as Complete button should be clicked");
    await sleep(3000);

    // Capture Screenshot 10: Baker Batch Completed
    const shot10 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "10_baker_batch_completed_order2_ready.png"), Buffer.from(shot10.data, "base64"));
    console.log("Saved: 10_baker_batch_completed_order2_ready.png");

    const completedBatch = await ProductionBatch.findById(batch._id);
    const completedOrder2 = await Order.findById(order2._id);
    assert.equal(completedBatch.status, S.COMPLETED, "Batch must be COMPLETED");
    assert.equal(completedOrder2.status, CUSTOMER_ORDER_STATUSES.READY, "Order 2 must be synchronized to READY");
    console.log("Confirmed: Batch is COMPLETED and Order 2 is READY");

    console.log("\n==============================================================");
    console.log("ALL BROWSER AUTOMATION VERIFICATIONS PASSED SUCCESSFULLY!");
    console.log("==============================================================");
  } finally {
    if (cdp) cdp.close();
    if (chromeProc) {
      chromeProc.kill();
      await sleep(1000);
    }

    // Clean up temporary database records (preserve real data)
    console.log("\nCleaning up test records...");
    try {
      if (batch) await ProductionBatch.deleteMany({ batchNumber: new RegExp(suffix.slice(-4)) });
      if (order1) await Order.deleteOne({ _id: order1._id });
      if (order2) await Order.deleteOne({ _id: order2._id });
      if (recipe) await Recipe.deleteOne({ _id: recipe._id });
      if (product) await Product.deleteOne({ _id: product._id });
      if (category) await Category.deleteOne({ _id: category._id });
      if (flour) {
        await InventoryLot.deleteMany({ ingredient: flour._id });
        await Ingredient.deleteOne({ _id: flour._id });
      }
      if (owner) {
        await User.deleteMany({
          _id: { $in: [owner._id, baker?._id, customer?._id].filter(Boolean) },
        });
        await Notification.deleteMany({
          recipient: { $in: [owner._id, baker?._id, customer?._id].filter(Boolean) },
        });
      }
      console.log("All test records cleaned up successfully.");
    } catch (cleanErr) {
      console.warn("Cleanup warning:", cleanErr.message);
    }

    try {
      await fs.rm(TEMP_USER_DATA, { recursive: true, force: true });
    } catch (_) {}

    await disconnectDb();
  }
}

main().catch((err) => {
  console.error("FATAL ERROR IN BROWSER VERIFICATION:", err);
  process.exit(1);
});