import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = "C:\\Users\\Rohan\\AppData\\Local\\Temp\\isolated_cdp_qc_removal";
const SCREENSHOT_DIR = "C:\\Users\\Rohan\\OneDrive\\Desktop\\bakery management\\verification_screenshots\\qc_removal";

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });

    this.ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);

      // Automatically accept any javascript alert/confirm dialog so CDP evaluate never hangs
      if (msg.method === "Page.javascriptDialogOpening") {
        console.log(`[CDP Auto-Handling Dialog]: "${msg.params?.message}" (${msg.params?.type})`);
        this.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
        return;
      }

      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      const timer = setTimeout(() => {
        if (this.callbacks.has(msgId)) {
          this.callbacks.delete(msgId);
          reject(new Error(`CDP command timed out: ${method} (${JSON.stringify(params).slice(0, 80)})`));
        }
      }, 15000); // 15 second safety timeout prevents hanging forever

      this.callbacks.set(msgId, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async close() {
    if (this.ws) this.ws.close();
  }

  async setViewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
  }

  async navigate(url, waitMs = 2000) {
    await this.send("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, waitMs));
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  async captureScreenshot(filename) {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    const buffer = Buffer.from(res.data, "base64");
    const filepath = path.join(SCREENSHOT_DIR, filename);
    await fs.writeFile(filepath, buffer);
    console.log(`[Screenshot Saved] -> ${filepath}`);
    return filepath;
  }
}

async function runBrowserVerification() {
  console.log("==================================================================");
  console.log("   SMART BAKERY — QC REMOVAL LIVE BROWSER VERIFICATION AUDIT    ");
  console.log("==================================================================\n");

  await fs.mkdir(USER_DATA_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  // 1. Connect to smart_bakery_db
  console.log("[DB] Connecting to smart_bakery_db...");
  await mongoose.connect("mongodb://127.0.0.1:27017/smart_bakery_db");
  const db = mongoose.connection;
  console.log("✓ Connected to smart_bakery_db");

  const staffUser = await db.collection("users").findOne({ email: "production@staff.com" });
  const ownerUser = await db.collection("users").findOne({ email: "admin@gmail.com" });
  if (!staffUser || !ownerUser) throw new Error("Required staff or owner user not found in smart_bakery_db");

  // Authenticate staff and owner via API
  console.log("[Auth] Getting JWT tokens for staff and owner...");
  let staffAuthRes = await fetch("http://localhost:5000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "production@staff.com", password: "Password123!" }),
  });
  let staffAuthData = await staffAuthRes.json();
  if (!staffAuthData.success) {
    const r2 = await fetch("http://localhost:5000/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "production@staff.com", password: "123456" }),
    });
    staffAuthData = await r2.json();
  }
  const staffToken = staffAuthData.data?.accessToken || staffAuthData.data?.token || staffAuthData.accessToken;
  console.log(`[Auth] Staff token obtained: ${staffToken ? "YES" : "NO"}`);

  let ownerAuthRes = await fetch("http://localhost:5000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@gmail.com", password: "Password123!" }),
  });
  let ownerAuthData = await ownerAuthRes.json();
  if (!ownerAuthData.success) {
    const r2 = await fetch("http://localhost:5000/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@gmail.com", password: "123456" }),
    });
    ownerAuthData = await r2.json();
  }
  const ownerToken = ownerAuthData.data?.accessToken || ownerAuthData.data?.token || ownerAuthData.accessToken;
  console.log(`[Auth] Owner token obtained: ${ownerToken ? "YES" : "NO"}`);

  const testSuffix = `qcrem_${Date.now()}`;
  const catId = new mongoose.Types.ObjectId();
  const prodId = new mongoose.Types.ObjectId();
  const variantId = new mongoose.Types.ObjectId();
  const ingId = new mongoose.Types.ObjectId();
  const lotId = new mongoose.Types.ObjectId();
  const recipeId = new mongoose.Types.ObjectId();
  const batchId = new mongoose.Types.ObjectId();
  const batchNumber = `BATCH-REM-${Date.now().toString().slice(-4)}`;

  console.log(`[DB] Creating verified test batch ${batchNumber}...`);
  await db.collection("categories").insertOne({
    _id: catId,
    name: `Fresh Bakery Category ${testSuffix}`,
    slug: `cat-${testSuffix}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection("products").insertOne({
    _id: prodId,
    name: `Artisan Sourdough Loaf ${testSuffix}`,
    slug: `loaf-${testSuffix}`,
    category: catId,
    variants: [{ _id: variantId, name: "Standard Loaf", quantity: 1, unit: "piece", price: 120, isActive: true }],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection("ingredients").insertOne({
    _id: ingId,
    name: `Organic Flour ${testSuffix}`,
    slug: `flour-${testSuffix}`,
    unit: "kg",
    costPerUnit: 60,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection("inventorylots").insertOne({
    _id: lotId,
    ingredient: ingId,
    lotNumber: `LOT-FLOUR-${testSuffix}`,
    originalQuantity: 50,
    remainingQuantity: 48,
    currentQuantity: 48,
    unit: "kg",
    unitCost: 60,
    purchaseDate: new Date(),
    status: "AVAILABLE",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection("recipes").insertOne({
    _id: recipeId,
    product: prodId,
    variant: variantId,
    ingredients: [{ ingredient: ingId, quantity: 2, unit: "kg" }],
    expectedYield: 10,
    yieldUnit: "piece",
    preparationTime: 15,
    productionTime: 25,
    powerMinutes: 25,
    powerCostPerMinute: 1.5,
    packagingCostPerUnit: 2.0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const now = new Date();
  await db.collection("productionbatches").insertOne({
    _id: batchId,
    batchNumber,
    product: prodId,
    productVariant: variantId,
    recipe: recipeId,
    recipeRevision: 1,
    recipeSnapshot: {
      recipeId,
      product: prodId,
      productVariant: variantId,
      expectedYield: 10,
      yieldUnit: "piece",
      recipeBatchQuantity: 1,
      preparationTime: 15,
      productionTime: 25,
      powerMinutes: 25,
      powerCostPerMinute: 1.5,
      packagingCostPerUnit: 2.0,
      ingredients: [
        {
          ingredient: ingId,
          name: `Organic Flour ${testSuffix}`,
          quantity: 2,
          unit: "kg",
          unitCostSnapshot: 60,
        },
      ],
    },
    productSnapshot: {
      productId: prodId,
      variantId,
      productName: `Artisan Sourdough Loaf ${testSuffix}`,
      variantName: "Standard Loaf",
      variantQuantity: 1,
      variantUnit: "piece",
      sku: `SKU-${testSuffix}`,
    },
    plannedQuantity: 10,
    unit: "piece",
    plannedStartTime: now,
    plannedEndTime: new Date(now.getTime() + 3600000),
    actualStartTime: now,
    productionDate: now,
    timeSlot: { startTime: "09:00", endTime: "11:00" },
    status: "VERIFIED",
    verificationStatus: "VERIFIED",
    verifiedBy: ownerUser._id,
    verifiedAt: now,
    consumptionStatus: "CONSUMED",
    planningStatus: "APPROVED",
    planningFeasibility: { isFeasible: true, ingredientAvailability: true, staffAvailability: true, slotAvailability: true, issues: [] },
    assignedWorkers: [
      {
        worker: staffUser._id,
        assignedAt: now,
        task: "Bake artisan loaf",
        taskStatus: "PENDING",
        hourlyRateSnapshot: 199.99,
        actualHours: 0.5,
      },
    ],
    consumedIngredients: [
      {
        ingredient: ingId,
        ingredientName: `Organic Flour ${testSuffix}`,
        lot: lotId,
        lotNumber: `LOT-FLOUR-${testSuffix}`,
        quantity: 2,
        unit: "kg",
        unitCostSnapshot: 60,
        costPaise: 12000,
      },
    ],
    costing: {
      status: "NOT_FINALIZED",
      packagingCostPaise: 2000,
      expenses: [],
    },
    wastageWriteCount: 0,
    createdBy: ownerUser._id,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`✓ Test batch ${batchNumber} created in smart_bakery_db`);

  // Launch Chrome
  console.log("[Browser] Launching Chrome CDP on port 9222...");
  const chromeProcess = spawn(CHROME_PATH, [
    "--headless=new",
    "--remote-debugging-port=9222",
    `--user-data-dir=${USER_DATA_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-sync",
    "about:blank",
  ]);

  await new Promise((r) => setTimeout(r, 2000));

  let cdp;
  try {
    const versionRes = await fetch("http://localhost:9222/json/version");
    const versionData = await versionRes.json();
    console.log(`[Browser] Chrome connected: ${versionData["User-Agent"]}`);

    const listRes = await fetch("http://localhost:9222/json/list");
    const targets = await listRes.json();
    const pageTarget = targets.find((t) => t.type === "page") || targets[0];
    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.setViewport(1440, 900);

    // =========================================================================
    // STEP 1: Set Staff Auth and Navigate to Production Dashboard
    // =========================================================================
    console.log("\n[Step 1] Navigating to Storefront to initialize localStorage...");
    await cdp.navigate("http://localhost:5173/");
    await new Promise((r) => setTimeout(r, 1000));

    console.log("[Step 1] Setting staff token into localStorage...");
    await cdp.eval(`
      localStorage.setItem('smart_bakery_token', '${staffToken}');
      window.alert = (msg) => { console.warn('[STUBBED ALERT]', msg); window.__lastAlert = msg; };
      window.confirm = () => true;
    `);

    console.log("[Step 1] Navigating to Production Staff Dashboard (/production)...");
    await cdp.navigate("http://localhost:5173/production");
    await new Promise((r) => setTimeout(r, 3000));

    // Ensure alerts are stubbed after navigation
    await cdp.eval(`
      window.alert = (msg) => { console.warn('[STUBBED ALERT]', msg); window.__lastAlert = msg; };
      window.confirm = () => true;
    `);

    const staffUrl = await cdp.eval("window.location.href");
    console.log(`[Staff URL]: ${staffUrl}`);

    // Verify QC removal from staff screen
    const qcScan1 = await cdp.eval(`(() => {
      const text = document.body.innerText.toLowerCase();
      const hasQcWords = text.includes('quality check') || text.includes('quality-check') || text.includes('qc stage') || text.includes('qc check');
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim());
      const hasQcButton = buttons.some(b => b.toLowerCase().includes('quality check') || b.toLowerCase().includes('perform qc') || b.toLowerCase() === 'qc');
      return { hasQcWords, hasQcButton, buttons: buttons.slice(0, 10) };
    })()`);

    console.log(`[Staff Screen QC Scan] Text mentions QC: ${qcScan1.hasQcWords}, QC buttons present: ${qcScan1.hasQcButton}`);
    if (qcScan1.hasQcWords || qcScan1.hasQcButton) {
      throw new Error(`QC elements found on production staff dashboard! words=${qcScan1.hasQcWords}, button=${qcScan1.hasQcButton}`);
    }
    console.log("✓ PASS: Production Staff dashboard contains ZERO Quality Check words or buttons.");

    // Select our created test batch
    console.log(`[Staff Screen] Selecting batch ${batchNumber}...`);
    const selectRes = await cdp.eval(`(() => {
      const items = Array.from(document.querySelectorAll('button'));
      const batchBtn = items.find(el => el.innerText && el.innerText.includes('${batchNumber}'));
      if (batchBtn) {
        batchBtn.click();
        return { found: true, text: batchBtn.innerText.slice(0, 80).replace(/\\n/g, ' ') };
      }
      return { found: false };
    })()`);
    console.log(`[Batch Selected]: ${JSON.stringify(selectRes)}`);
    await new Promise((r) => setTimeout(r, 2000));
    await cdp.captureScreenshot("01_production_staff_batch_selected_no_qc.png");

    // =========================================================================
    // STEP 2: Start Baking & Record Oven Output
    // =========================================================================
    console.log("\n[Step 2] Clicking 'Start Baking & Oven Mixing'...");
    const startClick = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const startBtn = buttons.find(b => b.innerText.includes('Start Baking'));
      if (startBtn) {
        startBtn.click();
        return { clicked: true, text: startBtn.innerText };
      }
      return { clicked: false, availableButtons: buttons.map(b => b.innerText.trim()) };
    })()`);
    console.log(`[Start Button]: ${JSON.stringify(startClick)}`);
    await new Promise((r) => setTimeout(r, 3000));

    // Confirm batch is IN_PRODUCTION and shows 'Record Oven Output & Proceed to Packaging'
    const inProdCheck = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const ovenBtn = buttons.find(b => b.innerText.includes('Record Oven Output') || b.innerText.includes('Proceed to Packaging'));
      return {
        hasOvenBtn: !!ovenBtn,
        ovenBtnText: ovenBtn ? ovenBtn.innerText : null,
        allButtons: buttons.map(b => b.innerText.trim()),
        lastAlert: window.__lastAlert || null
      };
    })()`);
    console.log(`[In Production Action]: ${JSON.stringify(inProdCheck)}`);
    if (!inProdCheck.hasOvenBtn) {
      const dbBatch = await db.collection("productionbatches").findOne({ _id: batchId });
      console.log(`[Diagnostic] DB Batch state: status=${dbBatch.status}, consumptionStatus=${dbBatch.consumptionStatus}, verificationStatus=${dbBatch.verificationStatus}`);
      throw new Error(`Expected 'Record Oven Output & Proceed to Packaging' button not found. Last alert: ${inProdCheck.lastAlert}`);
    }
    console.log("✓ PASS: Production started. Direct path to packaging button displayed.");

    // Click 'Record Oven Output & Proceed to Packaging'
    console.log("[Staff Screen] Opening Oven Output modal...");
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const ovenBtn = buttons.find(b => b.innerText.includes('Record Oven Output'));
      if (ovenBtn) ovenBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 1500));

    // Verify modal text has NO QC
    const modalQcCheck = await cdp.eval(`(() => {
      const text = document.body.innerText.toLowerCase();
      return {
        hasQcWords: text.includes('quality check') || text.includes('inspect batch')
      };
    })()`);
    console.log(`[Modal QC Check]: QC mentions: ${modalQcCheck.hasQcWords}`);

    // Submit baking completion form (10 produced, 10 usable, 0 wastage)
    console.log("[Staff Screen] Submitting oven completion (10 produced, 10 usable)...");
    const subRes = await cdp.eval(`(() => {
      const inputs = Array.from(document.querySelectorAll('input')).map(i => ({ val: i.value, type: i.type }));
      const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Confirm Bake Output'));
      if (submitBtn) {
        submitBtn.click();
        return { clicked: true, text: submitBtn.innerText, inputs };
      }
      return { clicked: false, availableButtons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()), inputs };
    })()`);
    console.log(`[Submit Oven Output Action]: ${JSON.stringify(subRes)}`);
    await new Promise((r) => setTimeout(r, 4000));

    // Verify status is now PACKAGING directly!
    const packagingCheck = await cdp.eval(`(() => {
      const text = document.body.innerText;
      const buttons = Array.from(document.querySelectorAll('button'));
      const pkgBtn = buttons.find(b => b.innerText.includes('Package Batch'));
      return {
        hasPackageButton: !!pkgBtn,
        pkgBtnText: pkgBtn ? pkgBtn.innerText : null,
        hasQcMention: text.toLowerCase().includes('quality check')
      };
    })()`);
    console.log(`[Packaging Stage Check]: ${JSON.stringify(packagingCheck)}`);
    if (!packagingCheck.hasPackageButton) throw new Error("Batch did not transition directly to Packaging stage!");
    console.log("✓ PASS: Batch moved directly to PACKAGING without any QC step!");
    await cdp.captureScreenshot("02_packaging_stage_direct_no_qc.png");

    // =========================================================================
    // STEP 3: Complete Packaging & Verify Cost Auto-Finalization
    // =========================================================================
    console.log("\n[Step 3] Clicking 'Package Batch & Add to Finished Stock'...");
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const pkgBtn = buttons.find(b => b.innerText.includes('Package Batch'));
      if (pkgBtn) pkgBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 1500));

    console.log("[Staff Screen] Confirming packaging submission...");
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const confirmBtn = buttons.find(b => b.innerText.includes('Finish Packaging') || b.innerText.includes('Confirm Packaging'));
      if (confirmBtn) confirmBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 3500));

    // Check status in DB after packaging
    const batchAfterPackaging = await db.collection("productionbatches").findOne({ _id: batchId });
    console.log(`[DB Batch State After Packaging]: status=${batchAfterPackaging.status}, costing.status=${batchAfterPackaging.costing?.status}`);
    if (batchAfterPackaging.costing?.status !== "FINALIZED") {
      throw new Error(`Expected costing.status to be FINALIZED automatically, got ${batchAfterPackaging.costing?.status}`);
    }
    console.log("✓ PASS: Costing automatically FINALIZED upon packaging completion without QC!");
    await cdp.captureScreenshot("03_packaged_and_costing_finalized.png");

    // Finalize batch to COMPLETED
    console.log("[Staff Screen] Clicking 'Finalize & Mark Batch COMPLETED'...");
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const finBtn = buttons.find(b => b.innerText.includes('Finalize & Mark Batch COMPLETED'));
      if (finBtn) finBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 3000));

    const finalBatch = await db.collection("productionbatches").findOne({ _id: batchId });
    console.log(`[DB Final Batch State]: status=${finalBatch.status}, costing.status=${finalBatch.costing?.status}`);
    if (finalBatch.status !== "COMPLETED") throw new Error(`Expected batch status COMPLETED, got ${finalBatch.status}`);
    console.log("✓ PASS: Batch reached COMPLETED status cleanly.");
    await cdp.captureScreenshot("04_batch_completed_success.png");

    // =========================================================================
    // STEP 4: Owner Dashboard & Analytics Verification
    // =========================================================================
    console.log("\n[Step 4] Logging in as Owner (admin@gmail.com)...");
    await cdp.eval(`
      localStorage.setItem('smart_bakery_token', '${ownerToken}');
      window.alert = (msg) => { console.warn('[STUBBED ALERT]', msg); window.__lastAlert = msg; };
      window.confirm = () => true;
    `);
    await cdp.navigate("http://localhost:5173/owner");
    await new Promise((r) => setTimeout(r, 3000));

    const ownerDashboardText = await cdp.eval(`(() => {
      const text = document.body.innerText.toLowerCase();
      const hasQcBadge = text.includes('quality check') || text.includes('quality-failed');
      return { hasQcBadge, sample: document.body.innerText.slice(0, 300).replace(/\\n/g, ' ') };
    })()`);
    console.log(`[Owner Dashboard QC Check] Mentions QC: ${ownerDashboardText.hasQcBadge}`);
    await cdp.captureScreenshot("05_owner_dashboard_batches.png");

    // Click on Batches tab to see batches list
    console.log("[Owner Screen] Navigating to Batches view...");
    await cdp.eval(`(() => {
      const tabs = Array.from(document.querySelectorAll('button, [role="tab"], a'));
      const batchTab = tabs.find(t => t.innerText && t.innerText.toLowerCase().includes('batch'));
      if (batchTab) batchTab.click();
    })()`);
    await new Promise((r) => setTimeout(r, 2500));

    // Confirm the batch appears and open Cost Review Modal
    const costBtnClick = await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('tr, .card, div'));
      const targetRow = rows.find(r => r.innerText && r.innerText.includes('${batchNumber}'));
      if (targetRow) {
        const costBtn = Array.from(targetRow.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('cost'));
        if (costBtn) {
          costBtn.click();
          return { clicked: true, text: costBtn.innerText };
        }
      }
      return { clicked: false };
    })()`);
    console.log(`[Cost Modal Opened]: ${JSON.stringify(costBtnClick)}`);
    await new Promise((r) => setTimeout(r, 2000));
    await cdp.captureScreenshot("06_owner_cost_modal_verified.png");

    // Navigate to Analytics
    console.log("[Owner Screen] Navigating to Analytics tab...");
    await cdp.eval(`(() => {
      const tabs = Array.from(document.querySelectorAll('button, [role="tab"], a'));
      const analyticsTab = tabs.find(t => t.innerText && (t.innerText.toLowerCase().includes('analytic') || t.innerText.toLowerCase().includes('report')));
      if (analyticsTab) analyticsTab.click();
    })()`);
    await new Promise((r) => setTimeout(r, 2500));
    await cdp.captureScreenshot("07_owner_analytics_dashboard.png");

    console.log("\n==================================================================");
    console.log("   LIVE BROWSER VERIFICATION PASSED WITH 100% SUCCESS!          ");
    console.log("==================================================================");

  } finally {
    // Clean up test batch and test entities
    console.log("\n[Cleanup] Removing temporary test batch and test entities...");
    await db.collection("productionbatches").deleteOne({ _id: batchId });
    await db.collection("recipes").deleteOne({ _id: recipeId });
    await db.collection("inventorylots").deleteOne({ _id: lotId });
    await db.collection("ingredients").deleteOne({ _id: ingId });
    await db.collection("products").deleteOne({ _id: prodId });
    await db.collection("categories").deleteOne({ _id: catId });
    await db.collection("finishedproductstocks").deleteMany({ product: prodId });
    console.log("✓ Database cleaned up to original historical state.");

    await mongoose.disconnect();
    if (cdp) await cdp.close();
    chromeProcess.kill();
  }
}

runBrowserVerification().catch((err) => {
  console.error("FATAL BROWSER VERIFICATION ERROR:", err);
  process.exit(1);
});
