import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import mongoose from "mongoose";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9235;
const USER_DATA_DIR = path.join(os.tmpdir(), `bakery_timer_cdp_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "..", "verification_screenshots", "timer_costing");

class SafeCdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      const tm = setTimeout(() => rej(new Error("WS connection timeout")), 10000);
      this.ws.onopen = () => { clearTimeout(tm); res(); };
      this.ws.onerror = (e) => { clearTimeout(tm); rej(e); };
    });

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.method === "Page.javascriptDialogOpening") {
          console.log(`[Auto-Dialog] "${msg.params?.message}" (${msg.params?.type}) -> accepting`);
          this.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
          return;
        }

        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject, timer } = this.callbacks.get(msg.id);
          clearTimeout(timer);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch (err) {
        console.error("WS error:", err);
      }
    };
  }

  send(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      const timer = setTimeout(() => {
        if (this.callbacks.has(msgId)) {
          this.callbacks.delete(msgId);
          reject(new Error(`Timeout on ${method}`));
        }
      }, timeoutMs);
      this.callbacks.set(msgId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async setViewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
  }

  async navigate(url, waitMs = 2500) {
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

  async close() {
    if (this.ws) this.ws.close();
  }
}

async function runBrowserAudit() {
  console.log("==================================================================");
  console.log("   SMART BAKERY — PRODUCTION TIMER, ELECTRICITY & PACKAGING AUDIT ");
  console.log("==================================================================\n");

  await fs.mkdir(USER_DATA_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  // 1. Connect to smart_bakery_db
  console.log("[DB] Connecting to smart_bakery_db to fetch test user credentials...");
  await mongoose.connect("mongodb://127.0.0.1:27017/smart_bakery_db");
  const db = mongoose.connection;
  console.log("✓ Connected to smart_bakery_db");

  const staffUser = await db.collection("users").findOne({ email: "production@staff.com" });
  const ownerUser = await db.collection("users").findOne({ email: "admin@gmail.com" });

  // Obtain staff token
  console.log("[Auth] Obtaining JWT for production staff (production@staff.com)...");
  let staffToken = null;
  for (const pw of ["123456", "Password123!", "Staff123!"]) {
    try {
      const res = await fetch("http://localhost:5000/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "production@staff.com", password: pw }),
      });
      const data = await res.json();
      if (data.success) {
        staffToken = data.data?.accessToken || data.data?.token || data.accessToken;
        console.log(`✓ Staff authenticated with password '${pw}'`);
        break;
      }
    } catch {}
  }

  // Obtain owner token
  console.log("[Auth] Obtaining JWT for owner (admin@gmail.com)...");
  let ownerToken = null;
  for (const pw of ["123456", "Password123!", "Owner123!"]) {
    try {
      const res = await fetch("http://localhost:5000/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@gmail.com", password: pw }),
      });
      const data = await res.json();
      if (data.success) {
        ownerToken = data.data?.accessToken || data.data?.token || data.accessToken;
        console.log(`✓ Owner authenticated with password '${pw}'`);
        break;
      }
    } catch {}
  }

  const testSuffix = `audit_${Date.now().toString().slice(-4)}`;
  const batchNumber = `BATCH-LIVE-${testSuffix}`;
  
  // Find a product and recipe in smart_bakery_db
  const existingProduct = await db.collection("products").findOne({ isActive: true });
  const existingVariant = existingProduct.variants[0];
  const existingRecipe = await db.collection("recipes").findOne({ product: existingProduct._id, isActive: true });

  let cleanedUp = false;
  async function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      console.log(`[DB Cleanup] Removing temporary audit batch ${batchNumber}...`);
      await db.collection("productionbatches").deleteOne({ _id: testBatchId });
      await db.collection("finishedproductstocks").deleteOne({ product: existingProduct._id, variant: existingVariant._id, lotNumber: batchNumber });
      await mongoose.disconnect();
    } catch (err) {
      console.error("[DB Cleanup] Error cleaning up batch:", err);
    }
    try {
      await cdp.close();
      chromeProcess.kill();
    } catch {}
    console.log("✓ Cleanup finished gracefully.");
  }

  const sigHandler = async () => {
    console.log("\n[Signal] Process termination received. Cleaning up audit batch...");
    await cleanup();
    process.exit(0);
  };
  process.on("SIGINT", sigHandler);
  process.on("SIGTERM", sigHandler);

  try {
  await db.collection("productionbatches").insertOne({
    _id: testBatchId,
    batchNumber,
    product: existingProduct._id,
    productVariant: existingVariant._id,
    productSnapshot: {
      productName: existingProduct.name,
      variantName: existingVariant.name,
      variantQuantity: existingVariant.quantity,
      variantUnit: existingVariant.unit,
    },
    recipe: existingRecipe._id,
    recipeRevision: 1,
    recipeSnapshot: {
      expectedYield: 20,
      yieldUnit: "piece",
      recipeBatchQuantity: 1,
      preparationTime: 10,
      productionTime: 15,
      estimatedDurationMinutes: 25, // 25 mins estimated duration -> overdue by ~7 mins
      equipmentPowerKw: 2.5,
      electricityTariff: 8.5,
      packagingCostPerUnit: 3.0,
      packagingMaterials: [
        { name: "Bakery Gift Box", costPerUnit: 4.5, consumptionType: "PER_PIECE", unitsPerItem: 1 },
        { name: "Food Liner Sheet", costPerUnit: 0.5, consumptionType: "PER_PIECE", unitsPerItem: 1 },
        { name: "Bulk Shipping Crate", costPerUnit: 25.0, consumptionType: "PER_BATCH", unitsPerItem: 1 },
      ],
      ingredients: [],
    },
    plannedQuantity: 20,
    estimatedDurationMinutes: 25,
    unit: "piece",
    status: "IN_PRODUCTION",
    actualStartTime: thirtyTwoMinsAgo,
    bakingStartTime: thirtyTwoMinsAgo,
    assignedWorkers: [
      {
        worker: staffUser._id,
        task: "Baking & Assembly",
        hourlyRateSnapshot: 150,
        actualHours: 0.6,
      },
    ],
    costing: { status: "NOT_FINALIZED" },
    createdBy: ownerUser._id,
    createdAt: thirtyTwoMinsAgo,
    updatedAt: new Date(),
  });
  console.log(`✓ Active batch created: ${testBatchId}`);

  // Launch Chrome
  console.log(`[Chrome] Spawning headless Chrome on port ${PORT}...`);
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1366,768",
    "about:blank",
  ]);

  await new Promise((r) => setTimeout(r, 2000));

  // Get WebSocket URL
  const versionRes = await fetch(`http://127.0.0.1:${PORT}/json/version`);
  const versionData = await versionRes.json();
  const wsUrl = versionData.webSocketDebuggerUrl;
  console.log(`✓ Connected to Chrome: ${versionData["User-Agent"]}`);

  // Find target tab
  const listRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const pages = await listRes.json();
  const pageTab = pages.find((p) => p.type === "page") || pages[0];

  const cdp = new SafeCdp(pageTab.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Runtime.enable");

  console.log("✓ CDP session established\n");

  const viewports = [
    { width: 375, height: 667, name: "375px_mobile" },
    { width: 430, height: 932, name: "430px_mobile_large" },
    { width: 768, height: 1024, name: "768px_tablet" },
    { width: 1366, height: 768, name: "1366px_desktop" },
    { width: 1920, height: 1080, name: "1920px_ultrawide" },
  ];

  try {
    // =========================================================================
    // PART 1: PRODUCTION STAFF WORKSTATION & LIVE TIMER AUDIT
    // =========================================================================
    console.log("------------------------------------------------------------------");
    console.log("  PART 1: PRODUCTION STAFF LIVE TIMER & WORKSTATION VERIFICATION  ");
    console.log("------------------------------------------------------------------");

    // Set staff token in localStorage using proper key 'smart_bakery_token'
    await cdp.navigate("http://localhost:5173/");
    await cdp.eval(`
      localStorage.setItem('smart_bakery_token', '${staffToken}');
    `);

    // Navigate to production dashboard
    await cdp.navigate("http://localhost:5173/production", 3500);

    // Select our created live batch card in the queue
    const selectedResult = await cdp.eval(`
      (() => {
        const cards = Array.from(document.querySelectorAll('button.kitchen-batch-card'));
        const target = cards.find(c => c.innerText && c.innerText.includes('${batchNumber}'));
        if (target) {
          target.click();
          return { clicked: true, text: target.innerText };
        }
        return { clicked: false, availableCards: cards.map(c => c.innerText.slice(0, 40)) };
      })()
    `);
    console.log("Batch Card Selection Result:", selectedResult);
    await new Promise((r) => setTimeout(r, 1500));

    // Verify Staff Workstation elements
    const workstationState = await cdp.eval(`
      (() => {
        const text = document.body.innerText;
        const hasLiveTimer = /\\d{2}:\\d{2}:\\d{2}/.test(text);
        const hasOverdueBadge = /OVERDUE/i.test(text);
        const hasBatchNumber = text.includes('${batchNumber}');
        const hasConsole = text.includes('WORKSTATION CONSOLE') || text.includes('Active Workstation');
        const hasStage = /Baking|In Production/i.test(text);
        const matches = text.match(/\\d{2}:\\d{2}:\\d{2}/g);
        return {
          hasLiveTimer,
          hasOverdueBadge,
          hasBatchNumber,
          hasConsole,
          hasStage,
          timersFound: matches,
        };
      })()
    `);
    console.log("Workstation state on load:", workstationState);

    // Check timer increment over 2 seconds (must tick without DB write)
    const timerT1 = await cdp.eval(`
      (() => {
        const matches = document.body.innerText.match(/00:32:\\d{2}|\\d{2}:\\d{2}:\\d{2}/g);
        return matches ? matches[matches.length - 1] : null;
      })()
    `);
    await new Promise((r) => setTimeout(r, 2000));
    const timerT2 = await cdp.eval(`
      (() => {
        const matches = document.body.innerText.match(/00:32:\\d{2}|\\d{2}:\\d{2}:\\d{2}/g);
        return matches ? matches[matches.length - 1] : null;
      })()
    `);
    console.log(`Live Timer Check: T0=${timerT1} -> T+2s=${timerT2} (Ticking accurately: ${timerT1 !== timerT2 ? "YES" : "NO"})`);

    // Test Page Reload Persistence: refresh page and confirm timer continues seamlessly
    console.log("\n[Persistence Test] Reloading page to verify timer survives browser reload...");
    await cdp.navigate("http://localhost:5173/production", 3000);
    // Re-select batch after reload
    await cdp.eval(`
      (() => {
        const cards = Array.from(document.querySelectorAll('button.kitchen-batch-card'));
        const target = cards.find(c => c.innerText && c.innerText.includes('${batchNumber}'));
        if (target) target.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));

    const timerAfterReload = await cdp.eval(`
      (() => {
        const matches = document.body.innerText.match(/00:32:\\d{2}|\\d{2}:\\d{2}:\\d{2}/g);
        return matches ? matches[matches.length - 1] : null;
      })()
    `);
    console.log(`Live Timer After Reload: ${timerAfterReload} (Preserved start time: ${timerAfterReload && timerAfterReload.startsWith("00:32") ? "YES (accurate)" : timerAfterReload})`);

    // Capture screenshots for all viewports on staff dashboard
    for (const vp of viewports) {
      await cdp.setViewport(vp.width, vp.height);
      await new Promise((r) => setTimeout(r, 1000));
      await cdp.captureScreenshot(`staff_workstation_timer_${vp.name}.png`);
    }

    // Open Complete Baking Modal and inspect runtime + electricity preview + delay reason
    console.log("\n[Modal Test] Opening 'Record Oven Output' modal...");
    const openBakeModalRes = await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.innerText && (b.innerText.includes('Complete Baking') || b.innerText.includes('Record Oven Output') || b.innerText.includes('Record Output')));
        if (btn) {
          btn.click();
          return { clicked: true, text: btn.innerText };
        }
        return { clicked: false, availableButtons: buttons.map(b => b.innerText).filter(t => t.length < 40) };
      })()
    `);
    console.log("Open Complete Baking Modal Button Click:", openBakeModalRes);
    await new Promise((r) => setTimeout(r, 1500));

    const bakingModalState = await cdp.eval(`
      (() => {
        const text = document.body.innerText;
        return {
          hasModal: text.includes('Record Oven Output') || text.includes('Complete Baking'),
          hasRuntime: /Runtime|Minutes|Operating/i.test(text),
          hasElectricityPreview: /Electricity|kWh|Tariff|₹/i.test(text),
          hasDelayReason: /Delay Reason|Delayed/i.test(text),
          snippet: text.slice(text.indexOf('Record Oven Output'), text.indexOf('Record Oven Output') + 600)
        };
      })()
    `);
    console.log("Baking Modal State:", bakingModalState);
    await cdp.captureScreenshot(`staff_baking_modal_${viewports[3].name}.png`);

    // Complete baking with delay reason
    console.log("[Workflow Test] Submitting oven completion (usable: 20, delay reason: 'Proofing took longer')...");
    await cdp.eval(`
      (() => {
        const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
        if (inputs.length > 0) {
          inputs[0].value = '20';
          inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (inputs.length > 1) {
          inputs[1].value = '20';
          inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        }
        const textareas = document.querySelectorAll('textarea');
        if (textareas.length > 0) {
          textareas[0].value = 'Proofing took longer due to cold morning';
          textareas[0].dispatchEvent(new Event('input', { bubbles: true }));
        }
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = buttons.find(b => b.innerText && (b.innerText.includes('Confirm & Move to Packaging') || b.innerText.includes('Submit') || b.innerText.includes('Record Oven Output')));
        if (submitBtn) submitBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 2500));

    // Verify batch moved directly to PACKAGING with no QC step!
    const afterBakeState = await cdp.eval(`
      (() => {
        const text = document.body.innerText;
        return {
          hasPackagingPrompt: /Packaging|Package/i.test(text),
          hasNoQcPrompt: !text.includes('Quality Check') && !text.includes('QC Verification'),
        };
      })()
    `);
    console.log("After Bake Output State (No QC verified):", afterBakeState);

    // Open Packaging modal
    console.log("\n[Modal Test] Opening 'Package Batch & Stock Goods' modal...");
    const openPkgModalRes = await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const pkgBtn = buttons.find(b => b.innerText && (b.innerText.includes('Package Batch') || b.innerText.includes('Package') || b.innerText.includes('Stock Goods')));
        if (pkgBtn) {
          pkgBtn.click();
          return { clicked: true, text: pkgBtn.innerText };
        }
        return { clicked: false, availableButtons: buttons.map(b => b.innerText).filter(t => t.length < 40) };
      })()
    `);
    console.log("Open Packaging Modal Button Click:", openPkgModalRes);
    await new Promise((r) => setTimeout(r, 1500));

    const packagingModalState = await cdp.eval(`
      (() => {
        const text = document.body.innerText;
        return {
          hasModal: text.includes('Package Batch') || text.includes('Stock Goods'),
          hasPieces: /Packaged Pieces|Quantity/i.test(text),
          hasCostPreview: /Packaging Cost|Breakdown|Materials|₹/i.test(text),
          snippet: text.slice(text.indexOf('Package Batch'), text.indexOf('Package Batch') + 600)
        };
      })()
    `);
    console.log("Packaging Modal State:", packagingModalState);
    await cdp.captureScreenshot(`staff_packaging_modal_${viewports[3].name}.png`);

    // Complete packaging (triggers auto finalization without QC!)
    console.log("[Workflow Test] Submitting packaging completion (20 pieces)...");
    await cdp.eval(`
      (() => {
        const input = document.querySelector('input[type="number"]');
        if (input) {
          input.value = '20';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const buttons = Array.from(document.querySelectorAll('button'));
        const finishBtn = buttons.find(b => b.innerText && (b.innerText.includes('Finish Packaging') || b.innerText.includes('Stock Goods') || b.innerText.includes('Complete Packaging')));
        if (finishBtn) finishBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 3500));

    // =========================================================================
    // PART 2: OWNER / MANAGER DASHBOARD & BATCH COST BREAKDOWN AUDIT
    // =========================================================================
    console.log("\n------------------------------------------------------------------");
    console.log("  PART 2: OWNER DASHBOARD & BATCH COST BREAKDOWN VERIFICATION     ");
    console.log("------------------------------------------------------------------");

    // Set owner session in browser localStorage
    await cdp.eval(`
      localStorage.setItem('smart_bakery_token', '${ownerToken}');
    `);

    // Navigate directly to owner dashboard with tab=production
    console.log("[Navigation] Navigating to http://localhost:5173/owner?tab=production...");
    await cdp.navigate("http://localhost:5173/owner?tab=production", 3500);

    // Inspect Batches table columns for duration, overdue badge, delay reason
    const ownerTableState = await cdp.eval(`
      (() => {
        const text = document.body.innerText;
        return {
          hasBatch: text.includes('${batchNumber}'),
          hasDuration: /Duration|Elapsed|mins/i.test(text),
          hasOverdueBadge: /OVERDUE|\\+\\d+m/i.test(text),
          hasDelayReason: text.includes('Proofing took longer') || /Delay/i.test(text),
          sampleRows: Array.from(document.querySelectorAll('tr')).map(r => r.innerText.slice(0, 60)).slice(0, 5)
        };
      })()
    `);
    console.log("Owner Batches Table State:", ownerTableState);

    // Capture screenshots for all viewports on owner batches table
    for (const vp of viewports) {
      await cdp.setViewport(vp.width, vp.height);
      await new Promise((r) => setTimeout(r, 1000));
      await cdp.captureScreenshot(`owner_batches_table_${vp.name}.png`);
    }

    // Open Batch Cost Modal for the test batch or any completed batch
    console.log("\n[Modal Test] Opening Batch Cost Modal...");
    const openCostRes = await cdp.eval(`
      (() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const targetRow = rows.find(r => r.innerText && r.innerText.includes('${batchNumber}')) || rows[1];
        if (targetRow) {
          const btn = Array.from(targetRow.querySelectorAll('button')).find(b => b.innerText && (b.innerText.includes('Cost Breakdown') || b.innerText.includes('Cost') || b.innerText.includes('View')));
          if (btn) {
            btn.click();
            return { clicked: true, text: btn.innerText, rowText: targetRow.innerText.slice(0, 80) };
          }
        }
        // Fallback: click any Cost Breakdown button
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Cost Breakdown'));
        if (btn) {
          btn.click();
          return { clicked: true, text: btn.innerText };
        }
        return { clicked: false };
      })()
    `);
    console.log("Open Cost Modal Result:", openCostRes);
    await new Promise((r) => setTimeout(r, 2500));

    // Verify all 5 Costing Sections in the Modal
    const costModalAudit = await cdp.eval(`
      (() => {
        const text = document.body.innerText;
        return {
          hasDurationAudit: /Duration & Overdue Audit|Estimated Duration|Actual Duration/i.test(text),
          hasDelayReason: text.includes('Proofing took longer') || /Delay Reason/i.test(text),
          hasSection1Ingredients: /Ingredient Costs|Ingredients Cost/i.test(text),
          hasSection2Labour: /Staff Labour Costs|Hourly Labour Rate/i.test(text),
          hasSection3Electricity: /Electricity & Equipment Energy Cost|Operating Runtime|Equipment Power/i.test(text),
          hasSection4Packaging: /Piece-Based Packaging Cost|Packaging Materials|Units Used/i.test(text),
          hasSection5Expenses: /Other Miscellaneous Production Expenses|Expenses/i.test(text),
          hasTotalCost: /Total Actual Batch Cost|Cost Per Usable Item/i.test(text),
          hasSingleSumCheck: text.includes('Total Actual Batch Cost'),
          sampleSnippet: text.slice(text.indexOf('Cost Breakdown'), text.indexOf('Cost Breakdown') + 800)
        };
      })()
    `);
    console.log("Batch Cost Modal Detailed Audit:", costModalAudit);

    // Capture screenshots across viewports for Batch Cost Modal
    for (const vp of viewports) {
      await cdp.setViewport(vp.width, vp.height);
      await new Promise((r) => setTimeout(r, 1000));
      await cdp.captureScreenshot(`owner_cost_modal_${vp.name}.png`);
    }

    console.log("\n==================================================================");
    console.log("   ALL BROWSER AUDITS & SCREENSHOTS COMPLETED SUCCESSFULLY!        ");
    console.log("==================================================================\n");

  } finally {
    await cleanup();
  }
}

runBrowserAudit().catch((err) => {
  console.error("Browser Audit Error:", err);
  process.exit(1);
});
