import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import mongoose from "mongoose";

// 25 second hard watchdog timeout
const watchdog = setTimeout(() => {
  console.error("WATCHDOG TIMEOUT: Test exceeded 25 seconds!");
  process.exit(1);
}, 25000);
watchdog.unref();

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9228;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_chrome_test_${Date.now()}`);

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

  send(method, params = {}, timeoutMs = 6000) {
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

  async eval(expression, timeoutMs = 6000) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, timeoutMs);
    return res?.result?.value;
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

async function main() {
  // Pre-flight check: ensure storefront frontend server is reachable
  const isCiStrict = process.env.CI_E2E === "true" || process.env.REQUIRE_BROWSER_TEST === "true";
  try {
    await fetch("http://localhost:5173/", { signal: AbortSignal.timeout(1500) });
  } catch (_err) {
    if (isCiStrict) {
      console.error("FAIL: Storefront dev server is not reachable at http://localhost:5173/ while running in strict E2E mode (CI_E2E/REQUIRE_BROWSER_TEST).");
      process.exit(1);
    }
    console.log("Skipping E2E browser acceptance test: storefront dev server is not running on http://localhost:5173/.");
    return;
  }

  console.log("Starting Chrome on port", PORT);
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

  try {
    // Wait for CDP endpoint to respond
    let version = null;
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (res.ok) {
          version = await res.json();
          break;
        }
      } catch (_) {}
    }

    if (!version) {
      throw new Error(`Chrome failed to start or listen on port ${PORT}`);
    }
    console.log(`[Browser] Chrome active: ${version.Browser}`);

    // Get all targets and find page type
    const tabsRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const tabs = await tabsRes.json();
    console.log("[Browser] Targets:", JSON.stringify(tabs.map(t => ({ type: t.type, url: t.url }))));
    let targetTab = tabs.find(t => t.type === "page");
    if (!targetTab) {
      targetTab = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: "PUT" })).json();
    }
    console.log(`[Browser] Using target tab: ${targetTab.id}, URL: ${targetTab.url}`);

    const cdp = new SafeCdp(targetTab.webSocketDebuggerUrl);
    await cdp.connect();
    console.log("[Browser] Connected to CDP session");

    // Enable Console
    cdp.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.method === "Runtime.consoleAPICalled") {
          console.log("[Browser Console]", msg.params.type, msg.params.args.map(a => a.value || a.description).join(" "));
        }
        if (msg.id && cdp.callbacks.has(msg.id)) {
          const { resolve, reject, timer } = cdp.callbacks.get(msg.id);
          clearTimeout(timer);
          cdp.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    };
    await cdp.send("Runtime.enable");

    // 1. Navigate to Storefront Home
    console.log("\n1. Navigating to Storefront Home: http://localhost:5173/");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/" });
    await sleep(2000);

    const homeUrl = await cdp.eval("window.location.href");
    const homeTitle = await cdp.eval("document.title");
    console.log(`[Home] Current URL: ${homeUrl}, Title: "${homeTitle}"`);

    // 2. Add product to basket
    console.log("\n2. Finding and clicking 'Add to basket' button...");
    const addResult = await cdp.eval(`(() => {
      const addBtns = Array.from(document.querySelectorAll('button')).filter(b => 
        (b.getAttribute('aria-label') || '').toLowerCase().includes('add') ||
        b.className.includes('product-add-button') ||
        b.innerText.toLowerCase().includes('add')
      );
      if (addBtns.length === 0) return { success: false, reason: 'No add button found' };
      addBtns[0].click();
      return { success: true, text: addBtns[0].innerText || addBtns[0].getAttribute('aria-label') };
    })()`);

    console.log("[Home] Add button click result:", JSON.stringify(addResult));
    await sleep(1500);

    // 3. Navigate to Checkout
    console.log("\n3. Navigating to Checkout: http://localhost:5173/checkout");
    await cdp.send("Page.navigate", { url: "http://localhost:5173/checkout" });
    await sleep(2500);

    const checkoutUrl = await cdp.eval("window.location.href");
    const checkoutPath = await cdp.eval("window.location.pathname");
    console.log(`[Checkout] URL: ${checkoutUrl}, Path: ${checkoutPath}`);

    if (checkoutPath === "/login") {
      throw new Error("REDIRECT DEFECT: Guest checkout redirected to /login!");
    }

    // Inspect checkout form details
    const checkoutState = await cdp.eval(`(() => {
      const heading = document.querySelector('h1, h2')?.innerText;
      const inputs = Array.from(document.querySelectorAll('input')).map(i => ({ name: i.name, id: i.id, type: i.type, value: i.value }));
      const hasSlotSelector = Boolean(document.querySelector('.slot-selector, [class*="slot"], [class*="Slot"]'));
      return { heading, inputCount: inputs.length, hasSlotSelector };
    })()`);
    console.log("[Checkout] Form state:", JSON.stringify(checkoutState));

    // Fill contact information and submit order as guest
    console.log("\n4. Filling checkout form (Phone: 9876543210, Name: Guest Customer, UPI payment)...");
    const fillResult = await cdp.eval(`(() => {
      function setReactInputValue(input, val) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Find contact phone input
      const phoneInput = document.getElementById('checkout-phone') || document.querySelector('input[type="tel"]');
      if (phoneInput) {
        setReactInputValue(phoneInput, '9876543210');
      }

      // Find contact name input
      const nameInput = document.getElementById('checkout-name');
      if (nameInput) {
        setReactInputValue(nameInput, 'Guest Customer');
      }

      // Find payment method radio for UPI if not already selected
      const upiRadio = Array.from(document.querySelectorAll('input[type="radio"], button')).find(el => 
        (el.value === 'MANUAL_UPI' || (el.innerText || '').toLowerCase().includes('upi'))
      );
      if (upiRadio && !upiRadio.checked) {
        upiRadio.click();
      }

      // Find and click first available slot button
      const availableSlotButton = Array.from(document.querySelectorAll('button')).find(b => 
        (b.innerText || '').toLowerCase().includes('spot remaining') || 
        (b.innerText || '').toLowerCase().includes('spots remaining')
      );
      if (availableSlotButton) {
        availableSlotButton.click();
      }

      return {
        phoneSet: Boolean(phoneInput),
        phoneVal: phoneInput ? phoneInput.value : '',
        nameSet: Boolean(nameInput),
        upiSelected: Boolean(upiRadio),
        slotClicked: Boolean(availableSlotButton),
        slotText: availableSlotButton ? availableSlotButton.innerText : 'none'
      };
    })()`);
    console.log("[Checkout] Fill inputs result:", JSON.stringify(fillResult));
    await sleep(1500);

    // Submit the form
    console.log("\n5. Submitting Checkout form...");
    const checkoutPageTextBefore = await cdp.eval("document.body.innerText");
    console.log("[Checkout Page Text Before Submit]:\n", checkoutPageTextBefore.slice(0, 500));

    const submitResult = await cdp.eval(`(() => {
      const submitBtn = document.querySelector('button[type="submit"]') ||
                        Array.from(document.querySelectorAll('button')).find(b => 
                          (b.innerText || '').toLowerCase().includes('place order') ||
                          (b.innerText || '').toLowerCase().includes('proceed') ||
                          (b.innerText || '').toLowerCase().includes('order')
                        );
      if (!submitBtn) return { success: false, reason: 'Submit button not found' };
      submitBtn.click();
      return { success: true, text: submitBtn.innerText };
    })()`);
    console.log("[Checkout] Submit click result:", JSON.stringify(submitResult));

    // Wait for redirect to /payment-upi/...
    console.log("\n6. Waiting for navigation to UPI payment page...");
    let destinationUrl = "";
    let destinationPath = "";
    for (let step = 0; step < 12; step++) {
      await sleep(500);
      destinationUrl = await cdp.eval("window.location.href");
      destinationPath = await cdp.eval("window.location.pathname");
      if (destinationPath !== "/checkout") break;
    }

    const checkoutPageTextAfter = await cdp.eval("document.body.innerText");
    console.log("[Checkout Page Text After Submit]:\n", checkoutPageTextAfter.slice(0, 500));

    console.log(`[Result] Destination URL: ${destinationUrl}`);
    console.log(`[Result] Destination Path: ${destinationPath}`);

    // Verify whether guest was redirected to login or reached UPI page
    if (destinationPath === "/login") {
      throw new Error("CRITICAL DEFECT DETECTED: Guest customer was redirected to /login during UPI checkout!");
    }

    if (!destinationPath.startsWith("/payment-upi/")) {
      // Check if there was a validation error on checkout page
      const errorOnPage = await cdp.eval(`(() => {
        const errEl = document.querySelector('.error, [role="alert"], [class*="error"], [class*="alert"]');
        return errEl ? errEl.innerText : null;
      })()`);
      throw new Error(`Failed to navigate to UPI payment page. Current path: ${destinationPath}. Page error: ${errorOnPage}`);
    }

    // Inspect UPI Payment Page
    console.log("\n7. Inspecting UPI payment page as guest customer...");
    const upiPageDetails = await cdp.eval(`(() => {
      const heading = document.querySelector('h1, h2')?.innerText;
      const fileInput = document.querySelector('input[type="file"]');
      const hasQrCode = Boolean(document.querySelector('img[alt*="QR"], [class*="qr"], canvas'));
      const text = document.body.innerText;
      const hasUpiId = text.includes('@') || text.toLowerCase().includes('upi');
      const searchParams = window.location.search;
      return {
        heading,
        hasFileInput: Boolean(fileInput),
        hasQrCode,
        hasUpiId,
        searchParams,
        isGuestAccessible: !text.toLowerCase().includes('please login')
      };
    })()`);

    console.log("[UPI Payment Page] Details:", JSON.stringify(upiPageDetails, null, 2));

    // Capture screenshot
    const screenshotDir = path.join(process.cwd(), "verification_screenshots");
    await fs.mkdir(screenshotDir, { recursive: true });
    const shotRes = await cdp.send("Page.captureScreenshot", { format: "png" });
    const shotPath = path.join(screenshotDir, "guest_upi_payment_live.png");
    await fs.writeFile(shotPath, Buffer.from(shotRes.data, "base64"));
    console.log(`[Screenshot] Saved live verification screenshot to: ${shotPath}`);

    // Check token and orderNumber params
    const tokenInUrl = destinationUrl.includes("token=");
    const orderNumberInUrl = destinationUrl.includes("orderNumber=");
    console.log(`[Verification] token in URL: ${tokenInUrl}`);
    console.log(`[Verification] orderNumber in URL: ${orderNumberInUrl}`);
    console.log(`[Verification] file input present: ${upiPageDetails.hasFileInput}`);

    console.log("\n=======================================================");
    console.log("SUCCESS: Guest UPI Checkout workflow verified in browser!");
    console.log("Guest customer was NOT redirected to login.");
    console.log("=======================================================");

    await cdp.close();
  } finally {
    clearTimeout(watchdog);
    try { chromeProc.kill("SIGKILL"); } catch (_) {}
    try { await fs.rm(TEMP_USER_DATA, { recursive: true, force: true }); } catch (_) {}
    try {
      const orderNumMatch = destinationUrl && destinationUrl.match(/orderNumber=([^&]+)/);
      if (orderNumMatch && orderNumMatch[1]) {
        const orderNum = decodeURIComponent(orderNumMatch[1]);
        console.log(`[Cleanup] Cleaning up test guest order ${orderNum} from database...`);
        const conn = await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/smart_bakery_db");
        await conn.connection.collection("orders").deleteOne({ orderNumber: orderNum });
        await mongoose.disconnect();
        console.log(`[Cleanup] Test order ${orderNum} cleaned up successfully.`);
      }
    } catch (cleanupErr) {
      console.warn("[Cleanup] Warning during order cleanup:", cleanupErr.message);
    }
  }
}

main().catch((err) => {
  console.error("\nTEST FAILED:", err);
  process.exit(1);
});
