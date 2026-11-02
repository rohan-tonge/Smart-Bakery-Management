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
const PORT = 9255;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_modal_test_chrome_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "modal");

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
    await sleep(2500);
    const currUrl = await cdp.eval("window.location.href");
    console.log("Current page URL:", currUrl);

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
        return { success: false, error: e.message, stack: e.stack, href: window.location.href };
      }
    })()`);
    console.log("Login result:", JSON.stringify(loginRes));
    if (!loginRes?.success) throw new Error("Login failed");

    // 2. Navigate to Owner Dashboard
    console.log("[4] Navigating to /owner ...");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/owner" });
    await sleep(2000);

    // Switch to Orders & Payments tab
    console.log("[5] Switching to Orders & Payments tab...");
    const tabSwitchRes = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const ordersTab = buttons.find(b => b.textContent.includes('Orders') || b.textContent.includes('Payments'));
      if (ordersTab) {
        ordersTab.click();
        return { success: true, text: ordersTab.textContent };
      }
      return { success: false };
    })()`);
    console.log("Tab switch:", JSON.stringify(tabSwitchRes));
    await sleep(1000);

    // Verify presence of screenshot button
    const btnCheck = await cdp.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const viewBtn = buttons.find(b => b.textContent.includes('View Screenshot') || b.textContent.includes('Inspect Screenshot'));
      return { found: !!viewBtn, text: viewBtn ? viewBtn.textContent.trim() : null };
    })()`);
    console.log("Screenshot button check:", JSON.stringify(btnCheck));
    if (!btnCheck.found) {
      throw new Error("Could not find View Screenshot / Inspect Screenshot button in Orders tab");
    }

    const testResults = [];

    // 3. Inspect across all 5 viewports
    for (const vp of VIEWPORTS) {
      console.log(`\n======================================================`);
      console.log(`Testing Modal at Viewport: ${vp.width}x${vp.height} (${vp.name})`);
      console.log(`======================================================`);

      await cdp.setViewport(vp.width, vp.height);
      await sleep(500);

      // Scroll down by 250px to test scroll stability
      await cdp.eval(`window.scrollTo(0, 250)`);
      await sleep(300);

      const beforeScrollY = await cdp.eval(`window.scrollY`);
      console.log(`[${vp.name}] Scroll position before open: ${beforeScrollY}px`);

      // Click View/Inspect Screenshot button
      const clickRes = await cdp.eval(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const viewBtn = buttons.find(b => b.textContent.includes('View Screenshot') || b.textContent.includes('Inspect Screenshot'));
        if (viewBtn) {
          viewBtn.click();
          return { clicked: true };
        }
        return { clicked: false };
      })()`);
      console.log(`[${vp.name}] Button clicked:`, JSON.stringify(clickRes));

      // Wait for modal to render and image to load
      await sleep(1200);

      // Measure scroll position while modal is open
      const openScrollY = await cdp.eval(`window.scrollY`);
      const bodyOverflow = await cdp.eval(`document.body.style.overflow`);
      console.log(`[${vp.name}] Scroll position with modal open: ${openScrollY}px (body.style.overflow: "${bodyOverflow}")`);

      // Verify scroll position did NOT change
      const scrollDiff = Math.abs(openScrollY - beforeScrollY);
      const scrollPreserved = scrollDiff === 0;
      console.log(`[${vp.name}] Scroll position preserved: ${scrollPreserved} (diff: ${scrollDiff}px)`);

      // Check modal inspection details
      const modalInfo = await cdp.eval(`(() => {
        const modal = document.querySelector('[role="dialog"]');
        if (!modal) return { open: false };
        const img = modal.querySelector('img');
        const closeBtn = modal.querySelector('button[aria-label*="Close"]');
        const title = modal.querySelector('#payment-proof-modal-title');
        const isDirectBodyChild = modal.parentElement === document.body;
        const rect = modal.getBoundingClientRect();
        const card = modal.querySelector('.card');
        const cardRect = card ? card.getBoundingClientRect() : null;

        return {
          open: true,
          isPortal: isDirectBodyChild,
          titleText: title ? title.textContent.trim() : null,
          hasCloseBtn: !!closeBtn,
          imgSrc: img ? img.src.substring(0, 40) + '...' : null,
          imgObjectFit: img ? window.getComputedStyle(img).objectFit : null,
          imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
          imgDimensions: img ? { width: img.naturalWidth, height: img.naturalHeight } : null,
          cardFitsViewport: cardRect ? (cardRect.width <= window.innerWidth && cardRect.height <= window.innerHeight) : false,
          cardDimensions: cardRect ? { width: Math.round(cardRect.width), height: Math.round(cardRect.height) } : null,
          windowDimensions: { width: window.innerWidth, height: window.innerHeight },
        };
      })()`);

      console.log(`[${vp.name}] Modal details:`, JSON.stringify(modalInfo, null, 2));

      // Capture screenshot
      const shotPath = path.join(SCREENSHOT_DIR, `modal_${vp.name}.png`);
      await cdp.captureScreenshot(shotPath);
      console.log(`[${vp.name}] Screenshot saved: ${shotPath}`);

      // Test closing: alternate between Escape key and Close button
      let closedVia = "";
      if (vp.width === 375 || vp.width === 768) {
        // Close via Escape key
        console.log(`[${vp.name}] Testing close via Escape key...`);
        await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 27, key: "Escape" });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 27, key: "Escape" });
        closedVia = "Escape key";
      } else if (vp.width === 430) {
        // Close via backdrop click
        console.log(`[${vp.name}] Testing close via Backdrop click...`);
        await cdp.eval(`(() => {
          const backdrop = document.querySelector('[role="dialog"]');
          if (backdrop) backdrop.click();
        })()`);
        closedVia = "Backdrop click";
      } else {
        // Close via Close button
        console.log(`[${vp.name}] Testing close via Close button...`);
        await cdp.eval(`(() => {
          const closeBtn = document.querySelector('[role="dialog"] button[aria-label*="Close"]');
          if (closeBtn) closeBtn.click();
        })()`);
        closedVia = "Close button";
      }

      await sleep(600);

      // Verify modal is closed
      const isClosed = await cdp.eval(`!document.querySelector('[role="dialog"]')`);
      const afterCloseScrollY = await cdp.eval(`window.scrollY`);
      const afterCloseOverflow = await cdp.eval(`document.body.style.overflow`);
      console.log(`[${vp.name}] Modal closed: ${isClosed} (via ${closedVia}), final scrollY: ${afterCloseScrollY}px, overflow: "${afterCloseOverflow}"`);

      testResults.push({
        viewport: `${vp.width}x${vp.height} (${vp.name})`,
        scrollPreserved,
        scrollDiff,
        beforeScrollY,
        openScrollY,
        afterCloseScrollY,
        bodyOverflowLocked: bodyOverflow === "hidden",
        bodyOverflowRestored: afterCloseOverflow !== "hidden",
        isPortal: modalInfo.isPortal,
        imgLoaded: modalInfo.imgLoaded,
        imgObjectFit: modalInfo.imgObjectFit,
        cardFitsViewport: modalInfo.cardFitsViewport,
        closedSuccessfully: isClosed,
        closedVia,
      });
    }

    console.log(`\n======================================================`);
    console.log("FINAL BROWSER VERIFICATION SUMMARY:");
    console.log(`======================================================`);
    console.table(testResults);

    const allPassed = testResults.every(
      (r) =>
        r.scrollPreserved &&
        r.isPortal &&
        r.imgLoaded &&
        r.imgObjectFit === "contain" &&
        r.cardFitsViewport &&
        r.closedSuccessfully
    );

    console.log("\nALL VIEWPORTS PASSED VERIFICATION:", allPassed);
    if (!allPassed) {
      process.exit(1);
    }
  } finally {
    cdp.close();
    chromeProc.kill("SIGKILL");
    try {
      await fs.rm(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
