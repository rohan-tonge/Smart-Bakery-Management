import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// 120s overall watchdog timeout
const watchdog = setTimeout(() => {
  console.error("WATCHDOG TIMEOUT: Audit exceeded 120 seconds!");
  process.exit(1);
}, 120000);
watchdog.unref();

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9230;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_audit_chrome_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "responsive");

const VIEWPORT_WIDTHS = [
  { width: 375, height: 667, name: "375px_mobile_compact" },
  { width: 430, height: 932, name: "430px_mobile_standard" },
  { width: 768, height: 1024, name: "768px_tablet" },
  { width: 1366, height: 768, name: "1366px_desktop" },
  { width: 1920, height: 1080, name: "1920px_ultrawide" },
];

const PAGES_TO_TEST = [
  { key: "home", title: "Home / Storefront", path: "/" },
  { key: "menu", title: "Menu Catalog", path: "/#menu-catalog" },
  { key: "product_detail", title: "Product Detail", path: "/product/6ad477fa00d7d2c05ca919e9" },
  { key: "cart", title: "Cart / Basket", path: "/cart" },
  { key: "checkout", title: "Checkout & Delivery Slots", path: "/checkout" },
  { key: "payment_upi", title: "UPI Payment Screen", path: "/payment-upi/6adc4cbb31d2901d988642ac?token=e2e754eb8d797e5081cb935c0ad5db35&orderNumber=ORD-2026-000011" },
  { key: "tracking", title: "Order Tracking", path: "/track?orderNumber=ORD-2026-000011&token=e2e754eb8d797e5081cb935c0ad5db35" },
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
        console.error("WS parse error:", err);
      }
    };
  }

  send(method, params = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      const timer = setTimeout(() => {
        if (this.callbacks.has(msgId)) {
          this.callbacks.delete(msgId);
          reject(new Error(`CDP method ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.callbacks.set(msgId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression, timeoutMs = 8000) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, timeoutMs);
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

  async captureScreenshot(filepath) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(filepath, Buffer.from(res.data, "base64"));
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runAudit() {
  console.log("=== STARTING RESPONSIVE AUDIT: CUSTOMER PAGES ===");
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await fs.mkdir(TEMP_USER_DATA, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "about:blank",
  ], { stdio: "ignore" });

  const auditLog = [];

  try {
    // Wait for CDP endpoint
    let version = null;
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (res.ok) { version = await res.json(); break; }
      } catch (_) {}
    }
    if (!version) throw new Error("Chrome failed to launch on port " + PORT);
    console.log(`[Browser] Chrome connected: ${version.Browser}`);

    const tabsRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const tabs = await tabsRes.json();
    let targetTab = tabs.find(t => t.type === "page");
    if (!targetTab) {
      targetTab = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: "PUT" })).json();
    }

    const cdp = new SafeCdp(targetTab.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    // Pre-populate cart by adding an item so Cart and Checkout pages have active content
    console.log("\n[Setup] Navigating to Home to initialize session & cart...");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/" });
    await sleep(2000);

    const setupCart = await cdp.eval(`(async () => {
      try {
        let guestId = localStorage.getItem('smart_bakery_guest_id');
        if (!guestId) {
          guestId = 'guest_audit_' + Date.now();
          localStorage.setItem('smart_bakery_guest_id', guestId);
        }
        const res = await fetch('/api/v1/cart/items', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-guest-id': guestId
          },
          body: JSON.stringify({
            productId: '6ad477fa00d7d2c05ca919e9',
            variantId: '6ad477fa00d7d2c05ca919ed',
            quantity: 1
          })
        });
        const data = await res.json();
        return { success: data.success, guestId };
      } catch (e) {
        return { error: e.message };
      }
    })()`);
    console.log("[Setup] Cart initialization:", JSON.stringify(setupCart));
    await sleep(1000);

    // Iterate through each viewport and each customer page
    for (const vp of VIEWPORT_WIDTHS) {
      console.log(`\n======================================================`);
      console.log(`INSPECTING VIEWPORT: ${vp.width}px x ${vp.height}px (${vp.name})`);
      console.log(`======================================================`);

      await cdp.setViewport(vp.width, vp.height);

      for (const page of PAGES_TO_TEST) {
        const url = `http://localhost:5173${page.path}`;
        await cdp.send("Page.navigate", { url });
        await sleep(1500);

        // Perform responsive checks
        const checkResults = await cdp.eval(`(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const winW = window.innerWidth;
          const scrollW = Math.max(docEl.scrollWidth, body.scrollWidth);
          const hasHorizontalOverflow = scrollW > winW + 1;

          // Offending overflowing elements
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
                overflowingElements.push(\`\${tag}\${id}\${cls} (overflow: +\${overflowAmount}px)\`);
                if (overflowingElements.length >= 5) break;
              }
            }
          }

          // Check broken images
          const brokenImages = Array.from(document.querySelectorAll('img'))
            .filter(img => img.src && !img.src.startsWith('data:') && (!img.complete || img.naturalWidth === 0))
            .map(img => img.src.slice(0, 100));

          // Check for small or clipped interactive elements
          const smallButtons = Array.from(document.querySelectorAll('button, a.btn'))
            .filter(b => {
              const r = b.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24);
            })
            .map(b => b.innerText || b.getAttribute('aria-label') || b.className);

          // Check navigation visibility
          const hasNav = Boolean(document.querySelector('nav, header, [role="navigation"]'));
          const pageTitle = document.title;
          const mainHeading = document.querySelector('h1, h2')?.innerText?.trim();

          return {
            winW,
            scrollW,
            hasHorizontalOverflow,
            overflowAmount: Math.max(0, scrollW - winW),
            overflowingElements,
            brokenImagesCount: brokenImages.length,
            brokenImages,
            smallButtonsCount: smallButtons.length,
            hasNav,
            mainHeading,
            pageTitle
          };
        })()`);

        // Screenshot
        const screenshotName = `${vp.width}px_${page.key}.png`;
        const screenshotPath = path.join(SCREENSHOT_DIR, screenshotName);
        await cdp.captureScreenshot(screenshotPath);

        const finding = {
          viewport: `${vp.width}px`,
          page: page.title,
          path: page.path,
          hasHorizontalOverflow: checkResults?.hasHorizontalOverflow,
          overflowAmount: checkResults?.overflowAmount,
          overflowingElements: checkResults?.overflowingElements || [],
          brokenImagesCount: checkResults?.brokenImagesCount || 0,
          screenshot: screenshotName,
        };
        auditLog.push(finding);

        const statusIcon = finding.hasHorizontalOverflow ? "❌ OVERFLOW" : "✅ PASS";
        console.log(`[${vp.width}px] ${page.title.padEnd(28)} | ${statusIcon} (win:${checkResults?.winW}px, scroll:${checkResults?.scrollW}px) | Broken Img: ${finding.brokenImagesCount}`);
        if (finding.hasHorizontalOverflow) {
          console.log(`   --> Elements causing overflow: ${finding.overflowingElements.join(", ")}`);
        }
      }
    }

    console.log("\n=======================================================");
    console.log("AUDIT SUMMARY COMPLETE");
    console.log("=======================================================");
    console.log(JSON.stringify(auditLog, null, 2));

    await cdp.close();
    return auditLog;
  } finally {
    clearTimeout(watchdog);
    try { chromeProc.kill("SIGKILL"); } catch (_) {}
    try { await fs.rm(TEMP_USER_DATA, { recursive: true, force: true }); } catch (_) {}
  }
}

runAudit().then((results) => {
  const defects = results.filter(r => r.hasHorizontalOverflow || r.brokenImagesCount > 0);
  console.log(`\nAudit completed: ${results.length} checks performed. ${defects.length} defects detected.`);
  process.exit(0);
}).catch(err => {
  console.error("\nAudit execution failed:", err);
  process.exit(1);
});
