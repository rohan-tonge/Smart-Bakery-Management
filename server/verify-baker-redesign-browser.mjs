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
import { connectToDb, disconnectDb } from "./src/config/db.js";
import { USER_ROLES, PRODUCTION_STATUS as S, CUSTOMER_ORDER_STATUSES } from "./src/utils/constants.js";
import { generateAccessToken } from "./src/utils/token.utils.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9269;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_redesign_browser_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "baker_dashboard_redesign");

const VIEWPORT_TESTS = [
  { width: 375, height: 667, name: "375px_mobile" },
  { width: 430, height: 932, name: "430px_mobile_large" },
  { width: 768, height: 1024, name: "768px_tablet" },
  { width: 1366, height: 768, name: "1366px_desktop" },
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
      const id = this.id++;
      const timer = setTimeout(() => {
        this.callbacks.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 10000);

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

async function main() {
  await connectToDb();
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  const suffix = `bdr_ui_${Date.now()}`;
  console.log(`Setting up test fixture with suffix: ${suffix}`);

  const owner = await User.create({
    name: `Master Baker ${suffix}`,
    email: `owner_${suffix}@testbakery.com`,
    password: "Password123!",
    role: USER_ROLES.OWNER,
    isActive: true,
  });

  const baker = await User.create({
    name: `Chef Marco ${suffix}`,
    email: `marco_${suffix}@testbakery.com`,
    password: "Password123!",
    role: USER_ROLES.PRODUCTION_STAFF,
    jobDesignation: "Head Sourdough Baker",
    isActive: true,
  });

  const bakerToken = generateAccessToken(baker);

  const category = await Category.create({
    name: `Sourdough Loaves ${suffix}`,
    slug: `sourdough-loaves-${suffix}`,
    isActive: true,
  });

  const variantId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    name: `Artisan Sourdough Loaf ${suffix}`,
    slug: `artisan-sourdough-${suffix}`,
    sku: `SOURDOUGH-${suffix}`,
    category: category._id,
    variants: [
      {
        _id: variantId,
        name: "Standard 2kg Loaf",
        sku: `SOURDOUGH-2KG-${suffix}`,
        price: 360,
        costPricePaise: 12000,
        isDefault: true,
        quantity: 2,
        unit: "kg",
      },
    ],
    totalTimeMinutes: 90,
    isActive: true,
  });

  const flour = await Ingredient.create({
    name: `Organic Spelt Flour ${suffix}`,
    slug: `spelt-flour-${suffix}`,
    sku: `SPELT-${suffix}`,
    category: "dry_goods",
    unit: "kg",
    costPerUnit: 45,
    minimumStock: 10,
    isActive: true,
  });

  const salt = await Ingredient.create({
    name: `Himalayan Pink Salt ${suffix}`,
    slug: `pink-salt-${suffix}`,
    sku: `SALT-${suffix}`,
    category: "dry_goods",
    unit: "g",
    costPerUnit: 0.1,
    minimumStock: 50,
    isActive: true,
  });

  await InventoryLot.create({
    lotNumber: `LOT-SPELT-${suffix}`,
    ingredient: flour._id,
    originalQuantity: 60,
    remainingQuantity: 60,
    unit: "kg",
    unitCost: 45,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  await InventoryLot.create({
    lotNumber: `LOT-SALT-${suffix}`,
    ingredient: salt._id,
    originalQuantity: 3000,
    remainingQuantity: 3000,
    unit: "g",
    unitCost: 0.1,
    purchaseDate: new Date(),
    status: "AVAILABLE",
  });

  const recipe = await Recipe.create({
    product: product._id,
    variant: variantId,
    ingredients: [
      { ingredient: flour._id, quantity: 1.5, unit: "kg" },
      { ingredient: salt._id, quantity: 30, unit: "g" },
    ],
    expectedYield: 2,
    yieldUnit: "kg",
    preparationTime: 30,
    productionTime: 60,
    estimatedDurationMinutes: 90,
    instructions: "Hydrate spelt flour with water and leaven. Ferment 4 hrs, score deeply and bake in stone deck oven.",
    isActive: true,
  });

  // Customer Order 1 with requested split packaging
  const order1 = await Order.create({
    orderNumber: `ORD-ALICE-${suffix.slice(-6)}`,
    customer: null,
    isGuest: true,
    guestId: `guest-alice-${suffix}`,
    items: [
      {
        productId: product._id,
        variantId,
        productName: product.name,
        variantName: "Standard 2kg Loaf",
        quantity: 1,
        unitPrice: 360,
        lineTotal: 360,
        specialInstructions: "Customer: Bake extra crispy dark crust, slice into thick pieces.",
        packInstructions: "Split 2kg into two 1kg gift packs",
      },
    ],
    subtotal: 360,
    total: 360,
    orderType: "PICKUP",
    deliveryDate: "2026-10-31",
    deliveryTimeSlot: "11:00 AM - 1:00 PM",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PAYMENT_CONFIRMED",
    contactName: "Alice Walker",
    contactPhone: "9876543210",
    specialInstructions: "Customer: Bake extra crispy dark crust, slice into thick pieces.",
    packInstructions: "Split 2kg into two 1kg gift packs",
    status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
  });

  // Customer Order 2
  const order2 = await Order.create({
    orderNumber: `ORD-BOB-${suffix.slice(-6)}`,
    customer: null,
    isGuest: true,
    guestId: `guest-bob-${suffix}`,
    items: [
      {
        productId: product._id,
        variantId,
        productName: product.name,
        variantName: "Standard 2kg Loaf",
        quantity: 1,
        unitPrice: 360,
        lineTotal: 360,
        specialInstructions: "Customer: Leave at front porch, do not ring doorbell.",
      },
    ],
    subtotal: 360,
    total: 360,
    orderType: "DELIVERY",
    deliveryDate: "2026-10-31",
    deliveryTimeSlot: "3:00 PM - 5:00 PM",
    paymentMethod: "MANUAL_UPI",
    paymentStatus: "PAYMENT_CONFIRMED",
    contactName: "Bob Miller",
    contactPhone: "9123456789",
    specialInstructions: "Customer: Leave at front porch, do not ring doorbell.",
    status: CUSTOMER_ORDER_STATUSES.CONFIRMED,
  });

  // Create Production Batch assigned to Chef Marco
  const batch = await ProductionBatch.create({
    batchNumber: `BATCH-${suffix.slice(-8).toUpperCase()}`,
    product: product._id,
    productVariant: variantId,
    productSnapshot: {
      productName: product.name,
      variantName: "Standard 2kg Loaf",
      variantQuantity: 2,
      variantUnit: "kg",
      totalTimeMinutes: 90,
    },
    recipe: recipe._id,
    recipeRevision: 1,
    recipeSnapshot: {
      expectedYield: 2,
      yieldUnit: "kg",
      recipeBatchQuantity: 2,
      ingredients: [
        { ingredient: flour._id, name: flour.name, quantity: 3.0, unit: "kg" },
        { ingredient: salt._id, name: salt.name, quantity: 60, unit: "g" },
      ],
      preparationTime: 30,
      productionTime: 60,
      estimatedDurationMinutes: 90,
    },
    plannedQuantity: 4, // 2 loaves of 2kg each = 4kg
    unit: "kg",
    status: S.PLANNED,
    planningStatus: "APPROVED",
    relatedOrders: [order1._id, order2._id],
    syncOrderStatus: true,
    assignedWorkers: [{ worker: baker._id, task: "Mix and bake sourdough batch" }],
    ownerInstructions: "Owner Note: VIP orders for Alice & Bob. Use deck oven #2 at 240C.",
    productionNotes: order1.specialInstructions,
    createdBy: owner._id,
  });

  console.log(`Created test batch: ${batch.batchNumber} with related orders.`);

  // Launch Chrome
  console.log("Launching Chrome CDP...");
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,OptimizationHints",
    "--disable-background-networking",
    "about:blank",
  ]);

  let cdp = null;

  try {
    // Wait for CDP readiness
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

    if (!wsUrl) throw new Error("Could not connect to Chrome CDP");
    console.log(`Connected to Chrome WS: ${wsUrl}`);

    cdp = new SafeCdp(wsUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    // Listen to console events
    cdp.ws.addEventListener("message", (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.method === "Runtime.consoleAPICalled") {
          const text = msg.params.args.map((a) => a.value || a.description || JSON.stringify(a)).join(" ");
          console.log(`  [BROWSER CONSOLE ${msg.params.type.toUpperCase()}]: ${text}`);
        }
      } catch {}
    });

    // Navigate to bakery app
    await cdp.send("Page.navigate", { url: "http://localhost:5173" });
    await sleep(1500);

    // Set baker auth in localStorage
    console.log("Setting authenticated baker session in localStorage...");
    await cdp.send("Runtime.evaluate", {
      expression: `
        localStorage.setItem('smart_bakery_token', '${bakerToken}');
        localStorage.setItem('smart_bakery_user', JSON.stringify({
          _id: '${baker._id}',
          name: '${baker.name}',
          email: '${baker.email}',
          role: 'PRODUCTION_STAFF'
        }));
      `,
    });

    // Navigate directly to production staff dashboard with batchId
    const dashboardUrl = `http://localhost:5173/production?batchId=${batch._id}`;
    console.log(`Navigating to baker dashboard: ${dashboardUrl}`);
    await cdp.send("Page.navigate", { url: dashboardUrl });
    await sleep(3000);

    // -----------------------------------------------------------------
    // VIEWPORT RESPONSIVENESS VERIFICATION AT ALL 4 VIEWPORTS
    // 375px (mobile), 430px (mobile large), 768px (tablet), 1366px (desktop)
    // -----------------------------------------------------------------
    console.log("\nVerifying Stage 1 (Accept) responsive rendering at all 4 viewports...");
    for (const vp of VIEWPORT_TESTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width <= 768,
      });
      await sleep(800);

      // Verify no horizontal overflow
      const overflowEval = await cdp.send("Runtime.evaluate", {
        expression: `
          JSON.stringify({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
          });
        `,
        returnByValue: true,
      });
      const overflowData = JSON.parse(overflowEval.result.value);
      console.log(`  [${vp.name}] scrollWidth: ${overflowData.scrollWidth}px, clientWidth: ${overflowData.clientWidth}px, overflow: ${overflowData.hasOverflow}`);
      assert.equal(overflowData.hasOverflow, false, `Horizontal overflow detected at ${vp.name}`);

      // Capture screenshot at each viewport
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const shotFile = path.join(SCREENSHOT_DIR, `01_stage1_accept_${vp.name}.png`);
      await fs.writeFile(shotFile, Buffer.from(shot.data, "base64"));
      console.log(`  Saved screenshot: ${shotFile}`);
    }

    // Set viewport to comfortable desktop for interactive walkthrough
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(600);

    // Verify Customer Remarks and Owner Notes are prominently displayed
    const remarksCheck = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          return {
            hasBatch: bodyText.includes('${batch.batchNumber}'),
            hasAliceRemark: bodyText.includes('Bake extra crispy dark crust'),
            hasPackInstruction: bodyText.includes('Split 2kg into two 1kg gift packs'),
            hasBobRemark: bodyText.includes('Leave at front porch'),
            hasOwnerNote: bodyText.includes('Use deck oven #2 at 240C'),
            hasAcceptButton: Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Accept Batch')),
            recipeTableVisible: document.querySelector('table') !== null
          };
        })();
      `,
      returnByValue: true,
    });
    console.log("\nStage 1 UI Verification:", remarksCheck.result.value);
    assert.equal(remarksCheck.result.value.hasBatch, true, "Batch number not found");
    assert.equal(remarksCheck.result.value.hasAliceRemark, true, "Alice customer remark not shown");
    assert.equal(remarksCheck.result.value.hasPackInstruction, true, "Pack instruction not shown");
    assert.equal(remarksCheck.result.value.hasOwnerNote, true, "Owner note not shown");
    assert.equal(remarksCheck.result.value.hasAcceptButton, true, "Accept Batch button missing");
    assert.equal(remarksCheck.result.value.recipeTableVisible, false, "Recipe table should NOT be visible before acceptance");

    // -----------------------------------------------------------------
    // ACTION 1: CLICK ACCEPT BATCH -> TRANSITION TO STAGE 2 (VERIFY)
    // -----------------------------------------------------------------
    console.log("\nAction 1: Clicking 'Accept Batch'...");
    await cdp.send("Runtime.evaluate", {
      expression: `
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Accept Batch'));
        if (btn) btn.click();
      `,
    });
    await sleep(2000);

    // Verify Stage 2: Recipe BOM Ingredients & Equipment appear
    const stage2Check = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          const table = document.querySelector('table');
          return {
            statusVerifiedOrAccepted: bodyText.includes('ACCEPTED') || bodyText.includes('Verify Recipe Ingredients'),
            hasFlour: bodyText.includes('Organic Spelt Flour') || (table && table.innerText.includes('Spelt')),
            hasSalt: bodyText.includes('Himalayan Pink Salt') || (table && table.innerText.includes('Salt')),
            hasEquipment: bodyText.includes('Commercial Baking Oven') && bodyText.includes('Digital Weighing Scale'),
            hasConfirmVerifyButton: Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Confirm Ingredients, Weights & Equipment Verified')),
            tableRows: table ? table.querySelectorAll('tbody tr').length : 0
          };
        })();
      `,
      returnByValue: true,
    });
    console.log("Stage 2 UI Verification:", stage2Check.result.value);
    assert.ok(stage2Check.result.value.tableRows >= 2, "Recipe BOM table must display all ingredients");
    assert.equal(stage2Check.result.value.hasEquipment, true, "Required equipment list missing");
    assert.equal(stage2Check.result.value.hasConfirmVerifyButton, true, "Confirm Verify button missing");

    const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "02_stage2_verify_ingredients_equipment.png"), Buffer.from(shot2.data, "base64"));
    console.log("Saved: 02_stage2_verify_ingredients_equipment.png");

    // -----------------------------------------------------------------
    // ACTION 2: CONFIRM VERIFY -> TRANSITION TO STAGE 3 (START BAKING)
    // -----------------------------------------------------------------
    console.log("\nAction 2: Clicking 'Confirm Ingredients, Weights & Equipment Verified'...");
    const action2Result = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          let alertCaught = null;
          window.alert = (msg) => { alertCaught = msg; console.error("WINDOW.ALERT CAUGHT:", msg); };
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Confirm Ingredients, Weights & Equipment Verified'));
          if (!btn) return { found: false };
          const disabled = btn.disabled;
          btn.click();
          return { found: true, disabled, alertCaught };
        })();
      `,
      returnByValue: true,
    });
    console.log("Action 2 Click Eval:", action2Result.result.value);
    await sleep(2500);

    // Verify Stage 3: Recipe Ingredients Table is HIDDEN
    const stage3Check = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          return {
            hasStartBakingBtn: Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Start Baking')),
            recipeTableVisible: document.querySelector('table') !== null,
            hasBatchDetails: bodyText.includes('${batch.batchNumber}') && bodyText.includes('Artisan Sourdough Loaf'),
            hasCustomerRemarks: bodyText.includes('Bake extra crispy dark crust')
          };
        })();
      `,
      returnByValue: true,
    });
    console.log("Stage 3 UI Verification (Recipe Table Hidden):", stage3Check.result.value);
    assert.equal(stage3Check.result.value.hasStartBakingBtn, true, "Start Baking button missing");
    assert.equal(stage3Check.result.value.recipeTableVisible, false, "CRITICAL: Recipe ingredients table must be HIDDEN once verified for baking!");

    const shot3 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "03_stage3_start_baking_recipe_hidden.png"), Buffer.from(shot3.data, "base64"));
    console.log("Saved: 03_stage3_start_baking_recipe_hidden.png");

    // -----------------------------------------------------------------
    // ACTION 3: START BAKING -> TRANSITION TO STAGE 4 (RECORD OUTPUT)
    // -----------------------------------------------------------------
    console.log("\nAction 3: Clicking 'Start Baking'...");
    const action3Result = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          let alertCaught = null;
          window.alert = (msg) => { alertCaught = msg; console.error("WINDOW.ALERT CAUGHT IN ACTION 3:", msg); };
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Start Baking'));
          if (!btn) return { found: false };
          const disabled = btn.disabled;
          btn.click();
          return { found: true, disabled, alertCaught };
        })();
      `,
      returnByValue: true,
    });
    console.log("Action 3 Click Eval:", action3Result.result.value);
    await sleep(2500);

    // Verify Stage 4: Compact 3-field output recording form, Recipe Table HIDDEN
    const stage4Check = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          const inputs = Array.from(document.querySelectorAll('input'));
          const selects = Array.from(document.querySelectorAll('select'));
          return {
            hasRecordOutputHeading: bodyText.includes('Record Baking Output'),
            hasQtyInput: inputs.some(i => i.placeholder && i.placeholder.includes('4.2') || i.type === 'number'),
            hasUnitSelect: selects.length > 0,
            hasRemarkInput: inputs.some(i => i.placeholder && i.placeholder.includes('nominal yield')),
            hasRecordButton: Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Record Output')),
            recipeTableVisible: document.querySelector('table') !== null
          };
        })();
      `,
      returnByValue: true,
    });
    console.log("Stage 4 UI Verification (Compact 3-field form):", stage4Check.result.value);
    assert.equal(stage4Check.result.value.hasRecordOutputHeading, true);
    assert.equal(stage4Check.result.value.hasQtyInput, true, "Output weight/qty input missing");
    assert.equal(stage4Check.result.value.hasUnitSelect, true, "Output unit dropdown missing");
    assert.equal(stage4Check.result.value.hasRemarkInput, true, "Baking remark input missing");
    assert.equal(stage4Check.result.value.recipeTableVisible, false, "CRITICAL: Recipe table must be HIDDEN during Stage 4");

    const shot4 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "04_stage4_record_output_form.png"), Buffer.from(shot4.data, "base64"));
    console.log("Saved: 04_stage4_record_output_form.png");

    // -----------------------------------------------------------------
    // ACTION 4: RECORD OUTPUT (4.2 kg, kg, remark) -> TRANSITION TO STAGE 5 (PACKAGE)
    // -----------------------------------------------------------------
    console.log("\nAction 4: Entering output 4.2 kg, unit kg, remark and saving...");
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          function setReactVal(el, val) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }

          let alertMsg = null;
          window.alert = (msg) => { alertMsg = msg; console.error("WINDOW.ALERT CAUGHT IN ACTION 4:", msg); };

          const qtyInput = document.querySelector('input[type="number"]');
          if (qtyInput) setReactVal(qtyInput, '4.2');

          const remarkInput = Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.includes('nominal yield'));
          if (remarkInput) setReactVal(remarkInput, 'Nominal yield, golden dark crust, trimmed edges');

          const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Record Output'));
          if (submitBtn) submitBtn.click();
        })();
      `,
    });
    await sleep(2500);

    // Verify Stage 5: Split packaging interface with available output, customer pack preference
    const stage5Check = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          const lower = bodyText.toLowerCase();
          return {
            hasPackagingHeading: lower.includes('split packaging') || lower.includes('package'),
            hasAvailableOutput: lower.includes('4.2') && lower.includes('available output'),
            hasCustomerPref: lower.includes('split 2kg into two 1kg gift packs'),
            hasAddRowButton: Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Add Package Row')),
            hasSavePackageButton: Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Save Packaging')),
            recipeTableVisible: document.querySelector('table') !== null
          };
        })();
      `,
      returnByValue: true,
    });
    console.log("Stage 5 UI Verification (Split Packaging):", stage5Check.result.value);
    assert.equal(stage5Check.result.value.hasPackagingHeading, true, "Split packaging heading missing");
    assert.equal(stage5Check.result.value.hasAvailableOutput, true, "Available output display missing");
    assert.equal(stage5Check.result.value.hasAddRowButton, true, "Add Package Row button missing");
    assert.equal(stage5Check.result.value.recipeTableVisible, false, "Recipe table must be HIDDEN in Stage 5");

    // Add a second package row for split packaging (Pack 1: 2 kg, Pack 2: 2.2 kg = 4.2 kg total)
    console.log("Configuring split packages: Pack 1 = 2 kg, Pack 2 = 2.2 kg...");
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          // Click Add Package Row
          const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Add Package Row'));
          if (addBtn) addBtn.click();
        })();
      `,
    });
    await sleep(600);

    // Fill in package rows
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          function setReactVal(el, val) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }

          const numberInputs = Array.from(document.querySelectorAll('input[type="number"]'));
          if (numberInputs.length >= 2) {
            setReactVal(numberInputs[0], '2.0');
            setReactVal(numberInputs[1], '2.2');
          }
          const textInputs = Array.from(document.querySelectorAll('input[type="text"]'));
          if (textInputs.length >= 2) {
            setReactVal(textInputs[0], 'Order 1 - Split Gift Pack 1 of 2');
            setReactVal(textInputs[1], 'Order 2 - Standard 2.2kg Family Pack');
          }
          const overallNote = Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.includes('kraft boxes'));
          if (overallNote) {
            setReactVal(overallNote, 'Sealed in food-grade kraft boxes with bakery ribbon');
          }
        })();
      `,
    });
    await sleep(600);

    const shot5 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "05_stage5_split_packaging_rows.png"), Buffer.from(shot5.data, "base64"));
    console.log("Saved: 05_stage5_split_packaging_rows.png");

    // -----------------------------------------------------------------
    // ACTION 5: SAVE PACKAGING -> TRANSITION TO STAGE 6 (COMPLETE)
    // -----------------------------------------------------------------
    console.log("\nAction 5: Clicking 'Save Packaging & Review'...");
    await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          let alertMsg = null;
          window.alert = (msg) => { alertMsg = msg; console.error("WINDOW.ALERT CAUGHT IN ACTION 5:", msg); };
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Save Packaging'));
          if (btn) btn.click();
        })();
      `,
    });
    await sleep(2500);

    // Verify Stage 6: Summary review card and Mark as Complete button
    const stage6Check = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          const lower = bodyText.toLowerCase();
          return {
            hasStage6Heading: lower.includes('stage 6') || lower.includes('mark as complete'),
            hasRecordedOutputSummary: lower.includes('4.2') && lower.includes('output'),
            hasPackagedTotalSummary: lower.includes('4.2') && lower.includes('packaged total'),
            hasPackagesList: lower.includes('pack #1') && lower.includes('pack #2'),
            hasMarkCompleteBtn: Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Mark as Complete'))
          };
        })();
      `,
      returnByValue: true,
    });
    console.log("Stage 6 UI Verification (Final Review):", stage6Check.result.value);
    assert.equal(stage6Check.result.value.hasStage6Heading, true);
    assert.equal(stage6Check.result.value.hasRecordedOutputSummary, true);
    assert.equal(stage6Check.result.value.hasPackagesList, true, "Split packages breakdown missing in final review");
    assert.equal(stage6Check.result.value.hasMarkCompleteBtn, true, "Mark as Complete button missing");

    const shot6 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "06_stage6_mark_as_complete.png"), Buffer.from(shot6.data, "base64"));
    console.log("Saved: 06_stage6_mark_as_complete.png");

    // -----------------------------------------------------------------
    // ACTION 6: CLICK MARK AS COMPLETE -> BATCH COMPLETED & ORDERS READY
    // -----------------------------------------------------------------
    console.log("\nAction 6: Clicking 'Mark as Complete'...");
    const action6Result = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          let alertMsg = null;
          window.alert = (msg) => { alertMsg = msg; console.error("WINDOW.ALERT CAUGHT IN ACTION 6:", msg); };
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Mark as Complete'));
          if (!btn) return { found: false };
          const disabled = btn.disabled;
          btn.click();
          return { found: true, disabled, alertMsg };
        })();
      `,
      returnByValue: true,
    });
    console.log("Action 6 Click Eval:", action6Result.result.value);
    await sleep(3500);

    // Verify batch is completed in database and UI
    const finalBatch = await ProductionBatch.findById(batch._id);
    console.log(`Final Batch status in DB: ${finalBatch.status}`);
    assert.equal(finalBatch.status, S.COMPLETED);

    const finalOrder1 = await Order.findById(order1._id);
    const finalOrder2 = await Order.findById(order2._id);
    console.log(`Order 1 status: ${finalOrder1.status}, Order 2 status: ${finalOrder2.status}`);
    assert.equal(finalOrder1.status, CUSTOMER_ORDER_STATUSES.READY, "Order 1 must transition to READY on batch completion");
    assert.equal(finalOrder2.status, CUSTOMER_ORDER_STATUSES.READY, "Order 2 must transition to READY on batch completion");

    // Verify UI reflects completed status
    const completedUiCheck = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          const lower = bodyText.toLowerCase();
          return {
            hasCompletedAlert: lower.includes('batch completed') && lower.includes('ready'),
            hasFinishedStockNote: lower.includes('finished stock')
          };
        })();
      `,
      returnByValue: true,
    });
    console.log("Terminal Completed UI Verification:", completedUiCheck.result.value);
    assert.equal(completedUiCheck.result.value.hasCompletedAlert, true, "Completed alert missing from UI");

    const shot7 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(SCREENSHOT_DIR, "07_terminal_batch_completed_order_ready.png"), Buffer.from(shot7.data, "base64"));
    console.log("Saved: 07_terminal_batch_completed_order_ready.png");

    console.log("\n==============================================================");
    console.log("ALL BROWSER AUTOMATION STEPS & VIEWPORTS PASSED SUCCESSFULLY!");
    console.log("==============================================================");
  } finally {
    if (cdp) cdp.close();
    chromeProc.kill();

    // Clean up test records
    try {
      await ProductionBatch.deleteMany({ batchNumber: new RegExp(suffix) });
      await Order.deleteMany({ orderNumber: new RegExp(suffix.slice(-6)) });
      await InventoryLot.deleteMany({ lotNumber: new RegExp(suffix) });
      await Recipe.deleteOne({ _id: recipe._id });
      await Product.deleteOne({ _id: product._id });
      await Category.deleteOne({ _id: category._id });
      await Ingredient.deleteMany({ _id: { $in: [flour._id, salt._id] } });
      await User.deleteMany({ email: new RegExp(suffix) });
      await fs.rm(TEMP_USER_DATA, { recursive: true, force: true });
    } catch (e) {
      console.warn("Cleanup error (ignored):", e.message);
    }

    await disconnectDb();
  }
}

main().catch((err) => {
  console.error("FATAL ERROR IN BROWSER VERIFICATION:", err);
  process.exit(1);
});
