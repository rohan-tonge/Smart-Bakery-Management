import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// 240s overall watchdog timeout
const watchdog = setTimeout(() => {
  console.error("WATCHDOG TIMEOUT: Dashboard audit exceeded 240 seconds!");
  process.exit(1);
}, 240000);
watchdog.unref();

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9245;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_dash_audit_chrome_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "dashboards");

const VIEWPORT_WIDTHS = [
  { width: 375, height: 667, name: "375px_mobile" },
  { width: 430, height: 932, name: "430px_mobile" },
  { width: 768, height: 1024, name: "768px_tablet" },
  { width: 1366, height: 768, name: "1366px_desktop" },
  { width: 1920, height: 1080, name: "1920px_ultrawide" },
];

const OWNER_TABS = [
  { id: "overview", name: "Overview" },
  { id: "orders", name: "Orders & Payments" },
  { id: "products", name: "Menu & Costing" },
  { id: "inventory", name: "Inventory" },
  { id: "production", name: "Production Board" },
  { id: "requisitions", name: "Requisitions" },
  { id: "staff", name: "Staff Management" },
  { id: "analytics", name: "Sales & Analytics" },
  { id: "qr", name: "Settings & QR" },
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
    await this.send("Emulation.setVisibleSize", { width, height }).catch(() => {});
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

async function runDashboardAudit() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

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

  try {
    let connected = false;
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      try {
        const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
        if (ver && ver.webSocketDebuggerUrl) {
          console.log(`[Browser] Chrome connected: ${ver.Browser}`);
          connected = true;
          break;
        }
      } catch (_) {}
    }
    if (!connected) throw new Error("Could not connect to Chrome debugging port");

    const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    let targetTab = tabs.find(t => t.type === "page");
    if (!targetTab) {
      targetTab = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: "PUT" })).json();
    }

    const cdp = new SafeCdp(targetTab.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    const auditResults = {
      ownerDashboard: [],
      managerRedirect: null,
      productionDashboard: [],
      accessControl: {},
      defectsFound: [],
    };

    const checkLayout = async () => {
      return await cdp.eval(`(() => {
        const docEl = document.documentElement;
        const body = document.body;
        const winW = window.innerWidth;
        const scrollW = Math.max(docEl.scrollWidth, body.scrollWidth);
        const hasHorizontalOverflow = scrollW > winW + 1;

        const overflowingElements = [];
        if (hasHorizontalOverflow) {
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            const r = el.getBoundingClientRect();
            if (r.right > winW + 1) {
              const tag = el.tagName.toLowerCase();
              const cls = el.className ? '.' + String(el.className).trim().split(/\\s+/).join('.') : '';
              const id = el.id ? '#' + el.id : '';
              const overflowAmount = Math.round(r.right - winW);
              overflowingElements.push(\`\${tag}\${id}\${cls} (+\${overflowAmount}px)\`);
              if (overflowingElements.length >= 4) break;
            }
          }
        }

        const brokenImages = Array.from(document.querySelectorAll('img'))
          .filter(img => img.src && !img.src.startsWith('data:') && (!img.complete || img.naturalWidth === 0))
          .map(img => img.src.slice(0, 80));

        const hasSidebar = Boolean(document.querySelector('.owner-sidebar, .production-layout, nav'));
        const activeTabText = document.querySelector('.owner-nav-item.active, [aria-current="page"]')?.innerText?.trim();

        return {
          winW,
          scrollW,
          hasHorizontalOverflow,
          overflowAmount: Math.max(0, scrollW - winW),
          overflowingElements,
          brokenImagesCount: brokenImages.length,
          hasSidebar,
          activeTabText,
          url: window.location.href,
        };
      })()`);
    };

    // =========================================================================
    // 1. AUTHENTICATE AS OWNER / MANAGER (admin@gmail.com / 123456)
    // =========================================================================
    console.log("\n[Step 1] Authenticating as OWNER / MANAGER (admin@gmail.com)...");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/" });
    await sleep(1000);

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
    console.log("Owner login result:", JSON.stringify(loginRes));
    if (!loginRes?.success) throw new Error(`Owner login failed: ${loginRes?.message || loginRes?.error}`);

    // Verify /manager redirect to /owner
    console.log("\n[Step 1.1] Testing /manager route redirect...");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/manager" });
    await sleep(1500);
    const managerUrl = await cdp.eval("window.location.href");
    const isOwnerRedirect = managerUrl.includes("/owner");
    console.log(`Navigated to /manager -> Landed at: ${managerUrl} (Redirected to /owner: ${isOwnerRedirect})`);
    auditResults.managerRedirect = { attemptedUrl: "/manager", landedUrl: managerUrl, success: isOwnerRedirect };

    // =========================================================================
    // 2. AUDIT OWNER DASHBOARD ACROSS 5 VIEWPORTS & 9 TABS
    // =========================================================================
    for (const vp of VIEWPORT_WIDTHS) {
      console.log(`\n======================================================`);
      console.log(`INSPECTING OWNER DASHBOARD: ${vp.width}px x ${vp.height}px (${vp.name})`);
      console.log(`======================================================`);
      await cdp.setViewport(vp.width, vp.height);

      for (const tab of OWNER_TABS) {
        const tabUrl = `http://localhost:5173/owner?tab=${tab.id}`;
        await cdp.send("Page.navigate", { url: tabUrl });
        await sleep(1500);

        // On mobile, test sidebar toggle open and close
        if (vp.width <= 768) {
          await cdp.eval(`(() => {
            const toggle = document.querySelector('.owner-nav-toggle');
            if (toggle && !document.querySelector('.owner-sidebar.is-open')) {
              toggle.click();
            }
          })()`);
          await sleep(200);
          await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, `owner_${vp.width}px_${tab.id}_menu_open.png`));
          await cdp.eval(`(() => {
            const toggle = document.querySelector('.owner-nav-toggle');
            if (toggle && document.querySelector('.owner-sidebar.is-open')) {
              toggle.click();
            }
          })()`);
          await sleep(200);
        }

        const metrics = await checkLayout();
        const screenshotFile = `owner_${vp.width}px_${tab.id}.png`;
        await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, screenshotFile));

        const finding = {
          viewport: `${vp.width}px`,
          role: "OWNER_MANAGER",
          tab: tab.name,
          tabId: tab.id,
          hasHorizontalOverflow: metrics?.hasHorizontalOverflow,
          overflowAmount: metrics?.overflowAmount,
          overflowingElements: metrics?.overflowingElements || [],
          screenshot: screenshotFile,
        };
        auditResults.ownerDashboard.push(finding);

        const statusIcon = finding.hasHorizontalOverflow ? "❌ OVERFLOW" : "✅ PASS";
        console.log(`[${vp.width}px] Owner Tab: ${tab.name.padEnd(20)} | ${statusIcon} (win:${metrics?.winW}px, scroll:${metrics?.scrollW}px)`);
        if (finding.hasHorizontalOverflow) {
          console.log(`   --> Elements: ${finding.overflowingElements.join(", ")}`);
          auditResults.defectsFound.push(finding);
        }
      }
    }

    // =========================================================================
    // 3. AUTHENTICATE AS PRODUCTION STAFF (production@staff.com / 123456)
    // =========================================================================
    console.log("\n[Step 3] Authenticating as PRODUCTION_STAFF (production@staff.com)...");
    await cdp.eval(`(() => {
      localStorage.clear();
      sessionStorage.clear();
    })()`);
    await cdp.send("Page.navigate", { url: "http://localhost:5173/" });
    await sleep(1000);

    const staffLoginRes = await cdp.eval(`(async () => {
      try {
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'production@staff.com', password: '123456' })
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
    console.log("Staff login result:", JSON.stringify(staffLoginRes));
    if (!staffLoginRes?.success) throw new Error(`Staff login failed: ${staffLoginRes?.message || staffLoginRes?.error}`);

    // =========================================================================
    // 4. AUDIT PRODUCTION STAFF DASHBOARD ACROSS 5 VIEWPORTS
    // =========================================================================
    for (const vp of VIEWPORT_WIDTHS) {
      console.log(`\n======================================================`);
      console.log(`INSPECTING PRODUCTION DASHBOARD: ${vp.width}px x ${vp.height}px (${vp.name})`);
      console.log(`======================================================`);
      await cdp.setViewport(vp.width, vp.height);

      await cdp.send("Page.navigate", { url: "http://localhost:5173/production" });
      await sleep(1500);

      const metrics = await checkLayout();
      const screenshotFile = `production_${vp.width}px_main.png`;
      await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, screenshotFile));

      const finding = {
        viewport: `${vp.width}px`,
        role: "PRODUCTION_STAFF",
        screen: "Production Staff Workstation",
        hasHorizontalOverflow: metrics?.hasHorizontalOverflow,
        overflowAmount: metrics?.overflowAmount,
        overflowingElements: metrics?.overflowingElements || [],
        screenshot: screenshotFile,
      };
      auditResults.productionDashboard.push(finding);

      const statusIcon = finding.hasHorizontalOverflow ? "❌ OVERFLOW" : "✅ PASS";
      console.log(`[${vp.width}px] Production Dashboard        | ${statusIcon} (win:${metrics?.winW}px, scroll:${metrics?.scrollW}px)`);
      if (finding.hasHorizontalOverflow) {
        console.log(`   --> Elements: ${finding.overflowingElements.join(", ")}`);
        auditResults.defectsFound.push(finding);
      }
    }

    // =========================================================================
    // 5. SECURITY & ACCESS CONTROL VERIFICATION FOR PRODUCTION STAFF
    // =========================================================================
    console.log("\n=======================================================");
    console.log("STEP 5: VERIFYING ROLE ACCESS CONTROL FOR PRODUCTION_STAFF");
    console.log("=======================================================");

    // Test frontend route protection: Production staff navigates to /owner
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner" });
    await sleep(1500);
    const navOwnerUrl = await cdp.eval("window.location.href");
    const blockedFromOwner = !navOwnerUrl.includes("/owner") && navOwnerUrl.includes("/production");
    console.log(`Production Staff navigated to /owner -> Resulting URL: ${navOwnerUrl} (Blocked & Redirected: ${blockedFromOwner})`);

    // Test frontend route protection: Production staff navigates to /manager
    await cdp.send("Page.navigate", { url: "http://localhost:5173/manager" });
    await sleep(1500);
    const navManagerUrl = await cdp.eval("window.location.href");
    const blockedFromManager = !navManagerUrl.includes("/manager") && navManagerUrl.includes("/production");
    console.log(`Production Staff navigated to /manager -> Resulting URL: ${navManagerUrl} (Blocked & Redirected: ${blockedFromManager})`);

    // Test API endpoints with Production Staff token
    const apiAccessChecks = await cdp.eval(`(async () => {
      const token = localStorage.getItem('smart_bakery_token');
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      };

      const endpoints = [
        { name: 'Sales Analytics', url: '/api/v1/analytics/sales' },
        { name: 'Analytics Summary', url: '/api/v1/analytics/summary' },
        { name: 'Profitability Report', url: '/api/v1/analytics/profitability' },
        { name: 'Store Settings', url: '/api/v1/settings' },
        { name: 'Vendors / Suppliers', url: '/api/v1/vendors' },
        { name: 'Purchases', url: '/api/v1/purchases' },
        { name: 'Customer Users List', url: '/api/v1/users' },
      ];

      const results = [];
      for (const ep of endpoints) {
        try {
          const res = await fetch(ep.url, { headers });
          results.push({ name: ep.name, url: ep.url, status: res.status, forbidden: res.status === 403 });
        } catch (e) {
          results.push({ name: ep.name, url: ep.url, error: e.message });
        }
      }
      return results;
    })()`);

    console.log("\nAPI Access Control Results for PRODUCTION_STAFF:");
    console.table(apiAccessChecks);
    auditResults.accessControl = {
      frontendBlockedFromOwner: blockedFromOwner,
      frontendBlockedFromManager: blockedFromManager,
      apiAccessChecks,
    };

    // Check absence of financial data on Production Dashboard DOM
    const financialLeakCheck = await cdp.eval(`(() => {
      const text = document.body.innerText;
      const terms = ['Revenue', 'Profit', 'Gross Margin', 'Supplier Cost', 'Razorpay', 'UPI QR Code'];
      const found = terms.filter(t => new RegExp('\\\\b' + t + '\\\\b', 'i').test(text));
      return { foundTerms: found, isClean: found.length === 0 };
    })()`);
    console.log("Financial leak check on /production screen:", JSON.stringify(financialLeakCheck));
    auditResults.accessControl.financialLeakCheck = financialLeakCheck;

    console.log("\n=======================================================");
    console.log("INTERNAL DASHBOARDS AUDIT SUMMARY");
    console.log("=======================================================");
    console.log(`Owner tabs checked: ${auditResults.ownerDashboard.length}`);
    console.log(`Production checks: ${auditResults.productionDashboard.length}`);
    console.log(`Total defects found: ${auditResults.defectsFound.length}`);

    await cdp.close();
    return auditResults;
  } finally {
    clearTimeout(watchdog);
    try { chromeProc.kill("SIGKILL"); } catch (_) {}
    try { await fs.rm(TEMP_USER_DATA, { recursive: true, force: true }); } catch (_) {}
  }
}

runDashboardAudit().then((results) => {
  console.log(`\nAudit completed successfully. Total layout defects: ${results.defectsFound.length}`);
  process.exit(0);
}).catch((err) => {
  console.error("Dashboard audit failed:", err);
  process.exit(1);
});
