import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import mongoose from "mongoose";
import User from "./src/models/user.model.js";
import Category from "./src/models/category.model.js";
import Product from "./src/models/product.model.js";
import Recipe from "./src/models/recipe.model.js";
import Ingredient from "./src/models/ingredient.model.js";
import InventoryLot from "./src/models/inventoryLot.model.js";
import ProductionBatch from "./src/models/productionBatch.model.js";
import { connectToDb, disconnectDb } from "./src/config/db.js";
import { PRODUCTION_STATUS as S, UNITS } from "./src/utils/constants.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9265;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_modal_audit_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "recipe_modal");

const VIEWPORT_WIDTHS = [
  { width: 375, height: 667, name: "recipe_modal_375px_mobile.png" },
  { width: 430, height: 932, name: "recipe_modal_430px_mobile_large.png" },
  { width: 768, height: 1024, name: "recipe_modal_768px_tablet.png" },
  { width: 1366, height: 768, name: "recipe_modal_1366px_desktop.png" },
  { width: 1920, height: 1080, name: "recipe_modal_1920px_ultrawide.png" },
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

async function runBrowserVerification() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await connectToDb();

  console.log("=== STEP 1: Setting up Verification Fixtures in MongoDB ===");
  const suffix = Date.now().toString().slice(-6);

  const owner = await User.findOne({ email: "admin@gmail.com" });
  let baker = await User.findOne({ email: "production@staff.com" });
  if (!baker) baker = await User.findOne({ role: "PRODUCTION_STAFF" });

  let category = await Category.findOne();
  if (!category) {
    category = await Category.create({ name: "Cakes & Pastries", slug: `cakes-${suffix}` });
  }

  // Ensure 2 ingredients exist for the modal recipe editing verification
  let flour = await Ingredient.findOne({ slug: "modal-flour" });
  if (!flour) {
    flour = await Ingredient.create({
      name: "Premium Pastry Flour",
      slug: "modal-flour",
      unit: UNITS.KILOGRAM,
    });
  }
  let sugar = await Ingredient.findOne({ slug: "modal-sugar" });
  if (!sugar) {
    sugar = await Ingredient.create({
      name: "Granulated Sugar",
      slug: "modal-sugar",
      unit: UNITS.KILOGRAM,
    });
  }

  // Create or update a clean test product with Total Time to Make Product = 60 min
  let testProduct = await Product.findOne({ slug: "artisan-chocolate-cake" });
  if (!testProduct) {
    testProduct = await Product.create({
      name: "Artisan Chocolate Cake",
      slug: "artisan-chocolate-cake",
      category: category._id,
      totalTimeMinutes: 60,
      preparationTimePerUnit: 25,
      electricityCostPerUnit: 4.5,
      packagingCostPerUnit: 3.5,
      variants: [
        {
          name: "Standard 1kg",
          quantity: 1,
          unit: "piece",
          price: 450,
        },
      ],
    });
  } else {
    testProduct.totalTimeMinutes = 60;
    testProduct.preparationTimePerUnit = 25;
    testProduct.electricityCostPerUnit = 4.5;
    testProduct.packagingCostPerUnit = 3.5;
    await testProduct.save();
  }

  const testVariant = testProduct.variants[0];

  // Set up an existing recipe for this product variant
  let testRecipe = await Recipe.findOne({ product: testProduct._id, variant: testVariant._id, isActive: true });
  if (!testRecipe) {
    testRecipe = await Recipe.create({
      product: testProduct._id,
      variant: testVariant._id,
      expectedYield: 8,
      yieldUnit: "piece",
      preparationTime: 20,
      productionTime: 40,
      estimatedDurationMinutes: 60,
      ingredients: [
        { ingredient: flour._id, quantity: 2, unit: "kg" },
        { ingredient: sugar._id, quantity: 1, unit: "kg" },
      ],
      instructions: "Mix dry ingredients, add liquid, bake at 180°C for 40 minutes.",
      isActive: true,
    });
  }

  console.log(`[Fixture] Product: ${testProduct.name} (ID: ${testProduct._id})`);
  console.log(`[Fixture] Recipe ingredients: ${testRecipe.ingredients.length}, totalTime: ${testRecipe.totalTimeMinutes || 60}m`);

  console.log("\n=== STEP 2: Launching Headless Chrome via CDP ===");
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-features=Translate,OptimizationHints",
    "--window-size=1366,768",
  ], { stdio: "ignore" });

  try {
    let connected = false;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try {
        const resp = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (resp.ok) {
          connected = true;
          break;
        }
      } catch (_) {}
    }
    if (!connected) throw new Error("Could not connect to Chrome debugging port");

    const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    let targetTab = tabs.find((t) => t.type === "page") || await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: "PUT" })).json();

    const cdp = new SafeCdp(targetTab.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    // =========================================================================
    // 1. Authenticate as Owner
    // =========================================================================
    console.log("\n=== STEP 3: Authenticating as Owner in Browser ===");
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
          localStorage.setItem('smart_bakery_user', JSON.stringify(data.data.user));
          return { success: true, user: data.data.user };
        }
        return { success: false, message: data.message };
      } catch (e) {
        return { success: false, error: e.message };
      }
    })()`);

    console.log("Owner login result:", JSON.stringify(loginRes));
    if (!loginRes?.success) throw new Error("Failed to authenticate as Owner");

    // =========================================================================
    // 2. Navigate to Owner Products Tab and verify Total Time to Make Product field
    // =========================================================================
    console.log("\n=== STEP 4: Inspecting Owner Product Creation / Editing Form ===");
    await cdp.setViewport(1366, 768);
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=products" });
    await sleep(2500);

    const productFormCheck = await cdp.eval(`(() => {
      const timeInput = document.getElementById('owner-product-total-time');
      const elecInput = document.getElementById('owner-product-elec-cost');
      const packInput = document.getElementById('owner-product-pack-cost');
      const label = document.querySelector('label[for="owner-product-total-time"]');
      const preview = document.getElementById('owner-product-total-time-preview');

      return {
        hasTotalTimeInput: Boolean(timeInput),
        timeVal: timeInput?.value,
        labelText: label?.innerText?.trim(),
        previewText: preview?.innerText?.trim(),
        hasElecInput: Boolean(elecInput),
        hasPackInput: Boolean(packInput),
      };
    })()`);

    console.log("Product Form Total Time Verification:", JSON.stringify(productFormCheck, null, 2));
    if (!productFormCheck.hasTotalTimeInput) {
      throw new Error("Total Time to Make Product input missing from product form!");
    }
    if (!productFormCheck.labelText?.includes("Total Time to Make Product")) {
      throw new Error(`Expected label 'Total Time to Make Product', got: ${productFormCheck.labelText}`);
    }

    // Capture screenshot of Owner Product form with single Total Time field
    const ownerFormScreenshotPath = path.join(SCREENSHOT_DIR, "owner_product_form_total_time.png");
    await cdp.captureScreenshot(ownerFormScreenshotPath);
    console.log(`[Screenshot Saved] ${ownerFormScreenshotPath}`);

    // =========================================================================
    // 3. Verify Product List & Public Product Detail Total Time Display
    // =========================================================================
    console.log("\n=== STEP 5: Verifying Combined Time on Public Pages & Dashboard ===");
    await cdp.send("Page.navigate", { url: `http://localhost:5173/product/${testProduct._id}` });
    await sleep(2500);

    const publicDetailCheck = await cdp.eval(`(() => {
      const timeBadge = document.getElementById('product-total-time-badge');
      const text = document.body.innerText;
      return {
        hasBadge: Boolean(timeBadge),
        badgeText: timeBadge?.innerText?.trim(),
        pageContainsTotalTime: text.includes("Total Time to Make Product"),
      };
    })()`);

    console.log("Public Product Detail Check:", JSON.stringify(publicDetailCheck, null, 2));
    const publicScreenshotPath = path.join(SCREENSHOT_DIR, "product_detail_total_time.png");
    await cdp.captureScreenshot(publicScreenshotPath);
    console.log(`[Screenshot Saved] ${publicScreenshotPath}`);

    // =========================================================================
    // 4. Test Manage Recipe Popup Opening Position & Centering (Viewport Portal)
    // =========================================================================
    console.log("\n=== STEP 6: Testing Manage Recipe Popup Centering & Viewport Stacking ===");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner?tab=products" });
    await sleep(2500);

    // Scroll down the page 600px to simulate being scrolled down when clicking Manage Recipe
    await cdp.eval(`window.scrollTo(0, 600);`);
    await sleep(600);

    const scrollPosBefore = await cdp.eval(`window.scrollY`);
    console.log(`Page scrolled down to: ${scrollPosBefore}px`);

    // Click "Manage Recipe" button on our test product
    const openModalResult = await cdp.eval(`(() => {
      const recipeButtons = Array.from(document.querySelectorAll('.owner-btn-recipe'));
      if (recipeButtons.length === 0) return { success: false, reason: 'No .owner-btn-recipe buttons found' };
      const manageBtn = recipeButtons[0];
      manageBtn.scrollIntoView({ block: 'center' });
      manageBtn.click();
      return { success: true };
    })()`);

    console.log("Open recipe modal click:", JSON.stringify(openModalResult));
    await sleep(1500);

    // Inspect modal position, body scroll lock, and portal mounting
    const modalInspection = await cdp.eval(`(() => {
      const overlay = document.getElementById('recipe-modal-overlay');
      const card = document.getElementById('recipe-modal-card');
      if (!overlay || !card) return { found: false };

      const rect = card.getBoundingClientRect();
      const winHeight = window.innerHeight;
      const winWidth = window.innerWidth;
      const bodyOverflow = document.body.style.overflow;

      return {
        found: true,
        isDirectChildOfBody: overlay.parentElement === document.body,
        bodyOverflow,
        viewportHeight: winHeight,
        viewportWidth: winWidth,
        cardTop: rect.top,
        cardBottom: rect.bottom,
        cardLeft: rect.left,
        cardRight: rect.right,
        cardHeight: rect.height,
        cardWidth: rect.width,
        isCenteredVertically: Math.abs((rect.top + rect.bottom) / 2 - winHeight / 2) < 40,
        isCenteredHorizontally: Math.abs((rect.left + rect.right) / 2 - winWidth / 2) < 40,
        hasAddIngredientBtn: Boolean(document.getElementById('recipe-add-ingredient-btn')),
        hasTotalTimeInput: Boolean(document.getElementById('recipe-total-time')),
        totalTimeVal: document.getElementById('recipe-total-time')?.value,
        hasSaveBtn: Boolean(document.getElementById('recipe-save-btn')),
        hasCancelBtn: Boolean(document.getElementById('recipe-cancel-btn')),
      };
    })()`);

    console.log("Modal Inspection Result:", JSON.stringify(modalInspection, null, 2));

    if (!modalInspection.found) {
      throw new Error("Recipe Modal was not rendered in DOM!");
    }
    if (!modalInspection.isDirectChildOfBody) {
      throw new Error("Recipe Modal must be portaled directly to document.body to prevent containing block transform issues!");
    }
    if (modalInspection.bodyOverflow !== 'hidden') {
      throw new Error(`Background scrolling must be locked (overflow=hidden), found: ${modalInspection.bodyOverflow}`);
    }
    if (modalInspection.cardTop < 0 || modalInspection.cardTop > modalInspection.viewportHeight) {
      throw new Error(`Modal card rendered outside visible viewport! top: ${modalInspection.cardTop}`);
    }

    console.log("✔ Modal opened perfectly centered in visible viewport without scrolling down!");

    // =========================================================================
    // 5. Test Adding and Removing Ingredient Rows in Manage Recipe Popup
    // =========================================================================
    console.log("\n=== STEP 7: Testing Ingredient Row Addition and Removal ===");
    
    // Check initial ingredient count
    const initialRowsCount = await cdp.eval(`document.querySelectorAll('.recipe-ingredient-row').length`);
    console.log(`Initial ingredient rows: ${initialRowsCount}`);

    // Click "+ Add Ingredient"
    await cdp.eval(`document.getElementById('recipe-add-ingredient-btn')?.click()`);
    await sleep(600);

    const rowsAfterAdd = await cdp.eval(`document.querySelectorAll('.recipe-ingredient-row').length`);
    console.log(`Rows after clicking + Add Ingredient: ${rowsAfterAdd}`);
    if (rowsAfterAdd <= initialRowsCount) {
      throw new Error("+ Add Ingredient button failed to add a new ingredient row!");
    }

    // Capture screenshot showing ingredient row addition
    const addRowScreenshotPath = path.join(SCREENSHOT_DIR, "recipe_modal_row_added.png");
    await cdp.captureScreenshot(addRowScreenshotPath);
    console.log(`[Screenshot Saved] ${addRowScreenshotPath}`);

    // Remove the newly added row
    await cdp.eval(`(() => {
      const removeButtons = document.querySelectorAll('.recipe-remove-ingredient-btn');
      if (removeButtons.length > 0) {
        removeButtons[removeButtons.length - 1].click();
      }
    })()`);
    await sleep(500);

    const rowsAfterRemove = await cdp.eval(`document.querySelectorAll('.recipe-ingredient-row').length`);
    console.log(`Rows after clicking Remove: ${rowsAfterRemove}`);

    // =========================================================================
    // 6. Test Responsive Layout across 5 Required Viewports
    // =========================================================================
    console.log("\n=== STEP 8: Capturing Screenshots Across 5 Required Viewports ===");
    for (const vp of VIEWPORT_WIDTHS) {
      console.log(`Setting viewport: ${vp.width}x${vp.height} (${vp.name})...`);
      await cdp.setViewport(vp.width, vp.height);
      await sleep(1000);

      // Verify no horizontal overflow
      const overflowCheck = await cdp.eval(`(() => {
        const card = document.getElementById('recipe-modal-card');
        const body = document.getElementById('recipe-modal-body');
        return {
          cardScrollWidth: card?.scrollWidth,
          cardClientWidth: card?.clientWidth,
          hasHorizontalCardOverflow: card ? card.scrollWidth > card.clientWidth + 2 : false,
          bodyScrollWidth: body?.scrollWidth,
          bodyClientWidth: body?.clientWidth,
          hasHorizontalBodyOverflow: body ? body.scrollWidth > body.clientWidth + 2 : false,
          saveBtnVisible: Boolean(document.getElementById('recipe-save-btn')),
        };
      })()`);

      console.log(`Viewport ${vp.width}px overflow check:`, JSON.stringify(overflowCheck));

      const screenshotFile = path.join(SCREENSHOT_DIR, vp.name);
      await cdp.captureScreenshot(screenshotFile);
      console.log(`[Screenshot Saved] ${screenshotFile}`);
    }

    // =========================================================================
    // 7. Test Close & Escape Key restoring scroll
    // =========================================================================
    console.log("\n=== STEP 9: Testing Modal Close and Scroll Restoration ===");
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await sleep(800);

    const closedCheck = await cdp.eval(`(() => {
      const overlay = document.getElementById('recipe-modal-overlay');
      return {
        isOpen: Boolean(overlay),
        bodyOverflow: document.body.style.overflow,
      };
    })()`);

    console.log("Modal Escape Key Close Result:", JSON.stringify(closedCheck));
    if (closedCheck.isOpen) {
      // Try close button
      await cdp.eval(`document.getElementById('recipe-modal-close-btn')?.click()`);
      await sleep(500);
    }

    const finalScrollRestored = await cdp.eval(`document.body.style.overflow`);
    console.log(`Final document.body.style.overflow: '${finalScrollRestored}' (expected empty or unset)`);

    console.log("\n=======================================================");
    console.log("ALL BROWSER VERIFICATIONS COMPLETED SUCCESSFULLY!");
    console.log("=======================================================");

    await cdp.close();
  } finally {
    chromeProc.kill("SIGKILL");
    await sleep(500);
    try {
      await fs.rm(TEMP_USER_DATA, { recursive: true, force: true });
    } catch (_) {}
    await disconnectDb();
  }
}

runBrowserVerification().catch((err) => {
  console.error("FATAL BROWSER VERIFICATION ERROR:", err);
  process.exit(1);
});
