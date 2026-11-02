import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// 60s safety watchdog
const watchdog = setTimeout(() => {
  console.error("WATCHDOG: Browser test timed out after 60 seconds");
  process.exit(1);
}, 60000);
watchdog.unref();

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9258;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_costing_chrome_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "costing");

class SafeCdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.consoleMessages = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const tm = setTimeout(() => reject(new Error("WS timeout")), 5000);
      this.ws.onopen = () => { clearTimeout(tm); resolve(); };
      this.ws.onerror = (e) => reject(e);
    });

    this.ws.onmessage = (msg) => {
      const parsed = JSON.parse(msg.data);
      if (parsed.method === "Runtime.consoleAPICalled") {
        this.consoleMessages.push({
          type: parsed.params.type,
          args: parsed.params.args?.map(a => a.value || a.description),
        });
      }
      if (parsed.id && this.callbacks.has(parsed.id)) {
        const { resolve, reject } = this.callbacks.get(parsed.id);
        this.callbacks.delete(parsed.id);
        if (parsed.error) reject(new Error(JSON.stringify(parsed.error)));
        else resolve(parsed.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  async setViewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
  }

  async captureScreenshot(filePath) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(filePath, Buffer.from(res.data, "base64"));
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  console.log("[1] Spawning Chrome on port", PORT);
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-extensions",
    "--window-size=1366,768",
    "about:blank",
  ], { detached: false });

  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const tabs = await res.json();
      const pageTab = tabs.find((t) => t.type === "page");
      if (pageTab && pageTab.webSocketDebuggerUrl) {
        wsUrl = pageTab.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(300);
  }

  if (!wsUrl) throw new Error("Could not connect to Chrome DevTools port");
  console.log("[2] Connected to Chrome DevTools at", wsUrl);

  const cdp = new SafeCdp(wsUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const results = {
    analyticsVerified: false,
    batchCostModalVerified: false,
    inrFormattingVerified: false,
    consoleErrors: [],
    details: {}
  };

  try {
    // 1. Authenticate as owner
    console.log("[3] Authenticating as Owner on http://localhost:5173/login ...");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/login" });
    await sleep(2000);

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
    if (!loginRes?.success) throw new Error("Login failed");

    // 2. Navigate to Owner Dashboard
    console.log("[4] Navigating to http://localhost:5173/owner ...");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner" });
    await sleep(2500);

    // 3. Switch to Sales & Analytics Tab
    console.log("[5] Selecting Sales & Analytics tab...");
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => b.textContent.includes('Sales & Analytics') || b.textContent.includes('Analytics'));
      if (btn) btn.click();
    })()`);
    await sleep(2000);

    // Verify INR symbols on KPI cards
    const analyticsMetrics = await cdp.eval(`(() => {
      const container = document.querySelector('.sales-analytics-container') || document.body;
      const text = container.innerText;
      const kpis = Array.from(document.querySelectorAll('.analytics-kpi-grid .card, .card')).map(c => c.innerText);
      const inrMatches = text.match(/₹[\\d,]+(\\.\\d{2})?/g) || [];
      return {
        hasInrSymbol: text.includes('₹'),
        inrSampleCount: inrMatches.length,
        inrSamples: inrMatches.slice(0, 10),
        kpiPreview: kpis.slice(0, 4).map(k => k.split('\\n').slice(0, 3).join(' | '))
      };
    })()`);
    console.log("Sales & Analytics INR check:", JSON.stringify(analyticsMetrics, null, 2));
    results.details.analytics = analyticsMetrics;
    if (analyticsMetrics.hasInrSymbol && analyticsMetrics.inrSampleCount > 0) {
      results.analyticsVerified = true;
    }

    await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, "analytics_inr_verified.png"));

    // 4. Switch to Production Batches Tab
    console.log("[6] Switching to Production tab...");
    await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => b.textContent.includes('Production'));
      if (btn) btn.click();
    })()`);
    await sleep(2000);

    // Check batch listing for costing buttons
    const batchListCheck = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const costButtons = buttons.filter(b => b.textContent.includes('Cost') || b.title?.includes('cost'));
      const badges = Array.from(document.querySelectorAll('.badge, span')).filter(s => s.textContent.includes('Cost:'));
      return {
        costButtonCount: costButtons.length,
        costButtons: costButtons.map(b => ({ text: b.textContent.trim(), title: b.title })),
        costBadges: badges.map(b => b.textContent.trim())
      };
    })()`);
    console.log("Batch listing costing check:", JSON.stringify(batchListCheck, null, 2));

    // 5. Open BatchCostModal
    console.log("[7] Clicking Cost Review button for first batch...");
    const openModalRes = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const costBtn = buttons.find(b => b.title && b.title.includes('cost breakdown') || b.title?.includes('finalize batch cost') || b.textContent.includes('Cost'));
      if (costBtn) {
        costBtn.click();
        return { clicked: true, text: costBtn.textContent.trim(), title: costBtn.title };
      }
      return { clicked: false };
    })()`);
    console.log("Open modal result:", JSON.stringify(openModalRes));
    await sleep(2000);

    // 6. Inspect BatchCostModal
    const modalCheck = await cdp.eval(`(() => {
      const modal = document.querySelector('[role="dialog"]') || document.querySelector('.modal-overlay') || document.querySelector('.modal-backdrop');
      if (!modal) return { open: false };
      const text = modal.innerText;
      const inrMatches = text.match(/₹[\\d,]+(\\.\\d{2})?/g) || [];
      const title = modal.querySelector('h2, h3, h4')?.textContent?.trim();
      const badges = Array.from(modal.querySelectorAll('.badge, span')).map(s => s.textContent.trim());
      const inputs = Array.from(modal.querySelectorAll('input')).map(i => ({ name: i.name, type: i.type, value: i.value, placeholder: i.placeholder }));
      const buttons = Array.from(modal.querySelectorAll('button')).map(b => b.textContent.trim());

      return {
        open: true,
        title,
        hasInrSymbol: text.includes('₹'),
        inrMatches: inrMatches.slice(0, 15),
        hasIngredientCost: text.includes('Ingredient') || text.includes('Ingredients'),
        hasLabourCost: text.includes('Labour') || text.includes('Labor'),
        hasPackagingCost: text.includes('Packaging'),
        hasPowerExpense: text.includes('Power') || text.includes('Expense'),
        hasSummaryCard: text.includes('Total Batch Cost') || text.includes('Total Cost'),
        inputsCount: inputs.length,
        buttonLabels: buttons.slice(0, 8),
      };
    })()`);
    console.log("BatchCostModal inspection:", JSON.stringify(modalCheck, null, 2));
    results.details.modal = modalCheck;

    if (modalCheck.open && modalCheck.hasInrSymbol) {
      results.batchCostModalVerified = true;
      results.inrFormattingVerified = true;
    }

    await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, "batch_cost_modal_verified.png"));

    // Close modal
    await cdp.eval(`(() => {
      const closeBtn = document.querySelector('button[aria-label*="Close"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Cancel' || b.textContent === '✕');
      if (closeBtn) closeBtn.click();
    })()`);
    await sleep(1000);

    // Check for console errors
    const errors = cdp.consoleMessages.filter(m => m.type === 'error');
    console.log(`Console messages: ${cdp.consoleMessages.length} total, ${errors.length} errors.`);
    results.consoleErrors = errors;

    console.log("\n=================== VERIFICATION SUMMARY ===================");
    console.log("Analytics INR Verified:        ", results.analyticsVerified);
    console.log("Batch Cost Modal Verified:     ", results.batchCostModalVerified);
    console.log("INR Currency Format Verified:  ", results.inrFormattingVerified);
    console.log("Console Errors:                ", results.consoleErrors.length);
    console.log("============================================================\n");

  } finally {
    cdp.close();
    chromeProc.kill();
    try {
      await fs.rm(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }
}

main().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
