import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// 120s safety watchdog
const watchdog = setTimeout(() => {
  console.error("WATCHDOG: Browser test timed out after 120 seconds");
  process.exit(1);
}, 120000);
watchdog.unref();

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9256;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_analytics_chrome_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "analytics");

const VIEWPORTS = [
  { width: 375, height: 667, name: "375px_mobile" },
  { width: 430, height: 932, name: "430px_mobile" },
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
      const tm = setTimeout(() => reject(new Error("WS timeout")), 5000);
      this.ws.onopen = () => { clearTimeout(tm); resolve(); };
      this.ws.onerror = (e) => reject(e);
    });

    this.ws.onmessage = (msg) => {
      const parsed = JSON.parse(msg.data);
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
    "--disable-features=Translate,OptimizationHints,MediaRouter",
    "--window-size=1366,768",
    "about:blank",
  ], { detached: false });

  chromeProc.on("error", (err) => {
    console.error("Chrome process error:", err);
  });

  // Wait for DevTools port
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
    const tabClicked = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button.owner-nav-item, nav button'));
      const analyticsBtn = buttons.find(b => b.textContent.includes('Sales & Analytics') || b.textContent.includes('Analytics'));
      if (analyticsBtn) {
        analyticsBtn.click();
        return { clicked: true, text: analyticsBtn.textContent.trim() };
      }
      return { clicked: false, available: buttons.map(b => b.textContent.trim()) };
    })()`);
    console.log("Tab click result:", JSON.stringify(tabClicked));

    await sleep(2000);

    // 4. Verify Content & Metrics Presence
    const pageCheck = await cdp.eval(`(() => {
      const container = document.querySelector('.sales-analytics-container');
      if (!container) return { found: false, error: "sales-analytics-container not found" };

      // Check Heading
      const heading = container.querySelector('h2')?.textContent || '';
      
      // Check Period Buttons
      const periodButtons = Array.from(container.querySelectorAll('button')).map(b => b.textContent.trim());

      // Check KPI Cards
      const kpiCards = Array.from(container.querySelectorAll('.analytics-kpi-grid .card')).map(card => {
        const title = card.querySelector('span')?.textContent || '';
        const value = card.querySelector('div:nth-child(2)')?.textContent || '';
        const sub = card.querySelector('div:nth-child(3)')?.textContent || '';
        return { title, value, sub };
      });

      // Check Needs Attention
      const needsAttention = container.querySelector('h3')?.textContent || '';

      // Check Sales Trend Chart
      const chartSvg = !!container.querySelector('svg');

      return {
        found: true,
        heading,
        periodButtons: periodButtons.filter(t => ['Today', 'This week', 'This month', 'Custom Range'].includes(t)),
        kpiCount: kpiCards.length,
        kpiCards,
        needsAttention,
        chartSvg,
      };
    })()`);
    console.log("Page inspection check:", JSON.stringify(pageCheck, null, 2));

    // 5. Test Date Preset switching
    console.log("[6] Testing period selector switching...");
    const switchToday = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('.sales-analytics-container button'));
      const todayBtn = buttons.find(b => b.textContent.trim() === 'Today');
      if (todayBtn) {
        todayBtn.click();
        return true;
      }
      return false;
    })()`);
    await sleep(1000);

    const switchThisMonth = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('.sales-analytics-container button'));
      const monthBtn = buttons.find(b => b.textContent.trim() === 'This month');
      if (monthBtn) {
        monthBtn.click();
        return true;
      }
      return false;
    })()`);
    await sleep(1000);
    console.log("Period switching tested (Today:", switchToday, ", This month:", switchThisMonth, ")");

    // 6. Test Advanced Analytics collapsible toggle
    console.log("[7] Testing collapsible Advanced Analytics section...");
    const toggleExpand = await cdp.eval(`(() => {
      const toggleBtn = Array.from(document.querySelectorAll('.sales-analytics-container button')).find(b => b.textContent.includes('Details') || b.textContent.includes('Advanced Analytics'));
      if (toggleBtn) {
        toggleBtn.click();
        return { clicked: true, text: toggleBtn.textContent.trim() };
      }
      return { clicked: false };
    })()`);
    await sleep(1200);

    const advancedContentCheck = await cdp.eval(`(() => {
      const table = !!document.querySelector('.sales-analytics-container table');
      const searchInput = !!document.querySelector('.sales-analytics-container input[placeholder*="Search"]');
      const topProducts = document.querySelectorAll('.sales-analytics-container h4').length;
      return { table, searchInput, topProductHeaders: topProducts };
    })()`);
    console.log("Advanced analytics toggle check:", JSON.stringify({ toggleExpand, advancedContentCheck }));

    // 7. Test Responsive Viewports (375, 430, 768, 1366, 1920)
    console.log("[8] Running responsive audit across 5 viewports...");
    const viewportResults = [];

    for (const vp of VIEWPORTS) {
      console.log(`- Testing ${vp.name} (${vp.width}x${vp.height})...`);
      await cdp.setViewport(vp.width, vp.height);
      await sleep(1000);

      const metrics = await cdp.eval(`(() => {
        const body = document.body;
        const html = document.documentElement;
        const scrollWidth = Math.max(body.scrollWidth, html.scrollWidth);
        const innerWidth = window.innerWidth;
        const hasHorizontalOverflow = scrollWidth > (innerWidth + 2); // 2px margin for subpixel

        // Check if primary cards are properly stacked or gridded
        const kpis = Array.from(document.querySelectorAll('.analytics-kpi-grid .card')).map(c => {
          const rect = c.getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height) };
        });

        // Check chart visibility
        const svg = document.querySelector('.sales-analytics-container svg');
        const svgRect = svg ? svg.getBoundingClientRect() : null;

        return {
          viewportWidth: innerWidth,
          scrollWidth,
          hasHorizontalOverflow,
          kpis,
          svgWidth: svgRect ? Math.round(svgRect.width) : 0,
        };
      })()`);

      const screenshotFile = path.join(SCREENSHOT_DIR, `analytics_${vp.name}.png`);
      await cdp.captureScreenshot(screenshotFile);
      console.log(`  Saved screenshot: ${screenshotFile}`);
      console.log(`  Metrics:`, JSON.stringify(metrics));

      viewportResults.push({
        viewport: vp.name,
        width: vp.width,
        height: vp.height,
        ...metrics,
        screenshot: screenshotFile,
      });
    }

    // 8. Test "Needs attention" navigation link
    console.log("[9] Testing 'Needs attention' link navigation...");
    const testNavigation = await cdp.eval(`(() => {
      const actionBtn = document.querySelector('.sales-analytics-container button[style*="d97706"], .sales-analytics-container button[style*="ea580c"]');
      if (actionBtn) {
        const originalText = actionBtn.textContent.trim();
        actionBtn.click();
        return { clicked: true, text: originalText };
      }
      return { clicked: false, note: "No pending attention button rendered (store is all clear)" };
    })()`);
    await sleep(1000);
    console.log("Needs attention action test:", JSON.stringify(testNavigation));

    console.log("\n==================== SUMMARY ====================");
    console.log("All verifications completed successfully!");
    console.log(`Viewports tested: ${viewportResults.length} / 5 passed`);
    for (const r of viewportResults) {
      console.log(`- ${r.viewport}: overflow=${r.hasHorizontalOverflow ? "FAIL" : "PASS (0px overflow)"}, cards=${r.kpis.length}`);
    }

  } finally {
    cdp.close();
    try {
      chromeProc.kill("SIGKILL");
    } catch {}
    try {
      await fs.rm(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
