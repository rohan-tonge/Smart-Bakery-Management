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
import { PRODUCTION_STATUS as S, USER_ROLES } from "./src/utils/constants.js";
import { generateAccessToken } from "./src/utils/token.utils.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9269;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_noreq_audit_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots");

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
  return new Promise((res) => setTimeout(res, ms));
}

async function runBrowserAudit() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await connectToDb();

  const suffix = `audit-${Date.now()}`;
  let staffUser = null;
  let category = null;
  let flour = null;
  let flourLot = null;
  let product = null;
  let recipe = null;
  let batch = null;

  try {
    staffUser = await User.create({
      name: "Chef Maya Baker",
      email: `maya-${suffix}@baker.com`,
      password: "Password123!",
      role: USER_ROLES.PRODUCTION_STAFF,
      jobDesignation: "Artisan Baker",
      isActive: true,
    });

    category = await Category.create({
      name: `Pastries ${suffix}`,
      slug: `pastries-${suffix}`,
      isActive: true,
    });

    flour = await Ingredient.create({
      name: `Organic Wheat Flour ${suffix}`,
      slug: `organic-flour-${suffix}`,
      sku: `WFLOUR-${suffix}`,
      category: "dry_goods",
      unit: "g",
      costPerUnit: 0.08,
      minimumStock: 100,
      isActive: true,
    });

    flourLot = await InventoryLot.create({
      lotNumber: `LOT-OFLOUR-${suffix}`,
      ingredient: flour._id,
      originalQuantity: 5000,
      remainingQuantity: 5000,
      unit: "g",
      unitCost: 0.08,
      purchaseDate: new Date(),
      status: "AVAILABLE",
    });

    const variantId = new mongoose.Types.ObjectId();
    product = await Product.create({
      name: `Croissant Loaf ${suffix}`,
      slug: `croissant-loaf-${suffix}`,
      category: category._id,
      totalTimeMinutes: 50,
      variants: [{
        _id: variantId,
        name: "Standard 400g",
        quantity: 1,
        unit: "piece",
        price: 180,
        isActive: true,
        isAvailable: true,
      }],
      isActive: true,
    });

    recipe = await Recipe.create({
      name: `Croissant Loaf Recipe ${suffix}`,
      product: product._id,
      variant: variantId,
      revision: 1,
      expectedYield: 2,
      yieldUnit: "piece",
      recipeBatchQuantity: 2,
      preparationTime: 20,
      productionTime: 30,
      ingredients: [
        { ingredient: flour._id, name: flour.name, quantity: 400, unit: "g" },
      ],
      instructions: "Laminate dough, proof and bake at 200C",
      isActive: true,
    });

    batch = await ProductionBatch.create({
      batchNumber: `BATCH-NO-REQ-${suffix}`,
      product: product._id,
      productVariant: variantId,
      productSnapshot: {
        productName: product.name,
        variantName: "Standard 400g",
        variantQuantity: 1,
        variantUnit: "piece",
      },
      recipe: recipe._id,
      recipeRevision: 1,
      recipeSnapshot: {
        expectedYield: 2,
        yieldUnit: "piece",
        recipeBatchQuantity: 2,
        ingredients: [
          { ingredient: flour._id, name: flour.name, quantity: 400, unit: "g" },
        ],
        preparationTime: 20,
        productionTime: 30,
      },
      plannedQuantity: 2,
      unit: "piece",
      status: S.VERIFIED,
      assignedWorkers: [{ worker: staffUser._id, task: "Bake Croissant Loaves" }],
      createdBy: staffUser._id,
    });

    console.log(`Created test batch ${batch.batchNumber} assigned to ${staffUser.email}`);

    // Launch Chrome
    const chrome = spawn(CHROME_PATH, [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${TEMP_USER_DATA}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      "--window-size=1400,900",
      "about:blank",
    ]);

    await sleep(2500);

    const jsonRes = await fetch(`http://127.0.0.1:${PORT}/json`);
    const targets = await jsonRes.json();
    const pageTarget = targets.find((t) => t.type === "page");
    if (!pageTarget) throw new Error("No page target found");

    const cdp = new SafeCdp(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    console.log("CDP connected directly to page target.");

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    // Login via Auth token directly in localStorage
    const token = generateAccessToken(staffUser);
    const userJson = JSON.stringify({
      id: staffUser._id.toString(),
      name: staffUser.name,
      email: staffUser.email,
      role: staffUser.role,
    });

    console.log("Navigating to production staff dashboard...");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/production" });
    await sleep(2000);

    // Set auth tokens in localStorage and reload
    await cdp.send("Runtime.evaluate", {
      expression: `
        localStorage.setItem('smart_bakery_token', '${token}');
        localStorage.setItem('smart_bakery_user', '${userJson.replace(/'/g, "\\'")}');
        window.location.href = 'http://localhost:5173/production?batchId=${batch._id}';
      `,
    });

    await sleep(2500);

    // Check page text and controls
    const inspectRes = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          const hasReqButton = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Request Ingredients from Store'));
          const hasStartButton = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Start Baking & Oven Mixing'));
          const hasRequisitionModal = document.querySelector('.modal-card-animated') !== null && bodyText.includes('Submit a formal stock requisition');
          const hasRecipeIngredients = bodyText.includes('Recipe Ingredients & Requirements') || bodyText.includes('Organic Wheat Flour');
          return {
            hasReqButton,
            hasStartButton,
            hasRequisitionModal,
            hasRecipeIngredients,
            batchNumberVisible: bodyText.includes('${batch.batchNumber}'),
          };
        })()
      `,
      returnByValue: true,
    });

    console.log("Page inspection result:", inspectRes.result?.value);

    // Take screenshot 1: Baker dashboard with assigned batch ready to start without requisition
    const shot1 = await cdp.send("Page.captureScreenshot", { format: "png" });
    const shotPath1 = path.join(SCREENSHOT_DIR, "direct_production_no_requisition.png");
    await fs.writeFile(shotPath1, Buffer.from(shot1.data, "base64"));
    console.log(`Saved screenshot 1 to: ${shotPath1}`);

    // Click "Start Baking & Oven Mixing" button
    console.log("Clicking 'Start Baking & Oven Mixing'...");
    const clickRes = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Start Baking & Oven Mixing'));
          if (btn) {
            btn.click();
            return { clicked: true };
          }
          return { clicked: false };
        })()
      `,
      returnByValue: true,
    });
    console.log("Start button click:", clickRes.result?.value);

    await sleep(2000);

    // Check updated status
    const postStartInspect = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          const inProductionBadge = bodyText.includes('IN_PRODUCTION') || bodyText.includes('Baking');
          const deductButton = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Deduct & Issue Recipe Ingredients'));
          return {
            inProductionBadge,
            deductButton,
          };
        })()
      `,
      returnByValue: true,
    });
    console.log("Post-start status:", postStartInspect.result?.value);

    // Take screenshot 2: In Production
    const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
    const shotPath2 = path.join(SCREENSHOT_DIR, "direct_production_in_production.png");
    await fs.writeFile(shotPath2, Buffer.from(shot2.data, "base64"));
    console.log(`Saved screenshot 2 to: ${shotPath2}`);

    cdp.close();
    chrome.kill();
    await sleep(1000);

    // Verify in database that batch is IN_PRODUCTION
    const dbBatch = await ProductionBatch.findById(batch._id);
    console.log(`Batch DB status after start: ${dbBatch.status}`);

    if (
      !inspectRes.result?.value.hasReqButton &&
      !inspectRes.result?.value.hasRequisitionModal &&
      inspectRes.result?.value.hasStartButton &&
      dbBatch.status === S.IN_PRODUCTION
    ) {
      console.log("\n>>> BROWSER AUDIT PASSED: Requisition requirements completely removed, direct production start verified! <<<\n");
    } else {
      throw new Error(`Browser audit check failed: ${JSON.stringify(inspectRes.result?.value)}`);
    }
  } finally {
    try {
      if (batch) await ProductionBatch.deleteOne({ _id: batch._id });
      if (recipe) await Recipe.deleteOne({ _id: recipe._id });
      if (product) await Product.deleteOne({ _id: product._id });
      if (flourLot) await InventoryLot.deleteOne({ _id: flourLot._id });
      if (flour) await Ingredient.deleteOne({ _id: flour._id });
      if (category) await Category.deleteOne({ _id: category._id });
      if (staffUser) await User.deleteOne({ _id: staffUser._id });
      await fs.rm(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
    await disconnectDb();
  }
}

runBrowserAudit().catch((err) => {
  console.error("Browser audit failed:", err);
  process.exit(1);
});
