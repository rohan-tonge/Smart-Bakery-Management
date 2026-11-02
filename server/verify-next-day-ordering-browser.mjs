import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.join(process.cwd(), "server", ".env") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import mongoose from "mongoose";
import User from "./src/models/user.model.js";
import Category from "./src/models/category.model.js";
import Product from "./src/models/product.model.js";
import FinishedProductStock from "./src/models/finishedProductStock.model.js";
import Order from "./src/models/order.model.js";
import { connectToDb, disconnectDb } from "./src/config/db.js";
import { generateAccessToken } from "./src/utils/token.utils.js";
import { getBakeryTodayString, getBakeryTomorrowString } from "./src/utils/date.utils.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9277;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_nextday_audit_${Date.now()}`);
const SCREENSHOT_DIR = path.join(process.cwd(), "verification_screenshots", "next_day_ordering");

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
      this.ws.onopen = () => {
        clearTimeout(tm);
        resolve();
      };
      this.ws.onerror = (e) => {
        clearTimeout(tm);
        reject(e);
      };
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
        reject(new Error(`Timeout waiting for CDP method: ${method}`));
      }, 20000);
      this.callbacks.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || res.exceptionDetails.exception?.description);
    }
    return res.result?.value;
  }

  async setViewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await this.send("Emulation.setVisibleSize", { width, height });
    await sleep(400);
  }

  async captureScreenshot(outPath) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    const buffer = Buffer.from(res.data, "base64");
    await fs.writeFile(outPath, buffer);
    console.log(`Saved screenshot: ${path.basename(outPath)}`);
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runBrowserAudit() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await connectToDb();
  console.log("Connected to MongoDB for seed and verification.");

  const suffix = `ui-${Date.now()}`;
  let chromeProc = null;
  let cdp = null;
  let category = null;
  let product = null;
  let stock = null;
  const createdOrderIds = [];

  try {
    // 1. Ensure test product with on-hand finished stock exists
    const owner = await User.findOne({ role: "OWNER_MANAGER" });
    category = await Category.findOne();
    if (!category) {
      category = await Category.create({ name: `Pastries ${suffix}`, slug: `pastries-${suffix}` });
    }

    const variantId = new mongoose.Types.ObjectId();
    product = await Product.create({
      name: `Almond Biscotti ${suffix}`,
      slug: `almond-biscotti-${suffix}`,
      category: category._id,
      isActive: true,
      isAvailable: true,
      variants: [
        {
          _id: variantId,
          name: "Standard Pack",
          quantity: 1,
          unit: "piece",
          price: 150,
          isActive: true,
          isAvailable: true,
        },
      ],
      totalTimeMinutes: 45,
      electricityCostPerUnit: 5,
      packagingCostPerUnit: 8,
    });

    stock = await FinishedProductStock.create({
      product: product._id,
      variant: variantId,
      onHandQuantity: 100,
      reservedQuantity: 0,
      updatedBy: owner._id,
    });
    console.log(`Created test product ${product.name} with on-hand stock.`);

    // 2. Launch headless Chrome with clean user-data-dir
    console.log("Launching Headless Chrome with CDP...");
    chromeProc = spawn(CHROME_PATH, [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${TEMP_USER_DATA}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1366,768",
      "about:blank",
    ]);

    await sleep(2500);

    const jsonRes = await fetch(`http://127.0.0.1:${PORT}/json`);
    const targets = await jsonRes.json();
    const pageTarget = targets.find((t) => t.type === "page");
    if (!pageTarget) throw new Error("No page target found");

    cdp = new SafeCdp(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    console.log("CDP connected to Chrome tab.");

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    const appUrl = "http://localhost:5173";

    // -------------------------------------------------------------
    // STEP 1: Add product to basket via guest cart API
    // -------------------------------------------------------------
    console.log("Navigating to home page to initialize guest session...");
    await cdp.send("Page.navigate", { url: `${appUrl}/` });
    await sleep(2500);

    const cartAddRes = await cdp.eval(`
      (async () => {
        let guestId = localStorage.getItem('smart_bakery_guest_id');
        if (!guestId) {
          guestId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
          localStorage.setItem('smart_bakery_guest_id', guestId);
        }
        const res = await fetch('/api/v1/cart/items', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-guest-id': guestId,
          },
          body: JSON.stringify({
            productId: "${product._id.toString()}",
            variantId: "${variantId.toString()}",
            quantity: 1,
          })
        });
        return { status: res.status, data: await res.json() };
      })()
    `);
    console.log("Cart add response:", cartAddRes.status, cartAddRes.data?.message || "OK");

    // -------------------------------------------------------------
    // STEP 2: Checkout Page - Responsive Viewports & Validation Audit
    // -------------------------------------------------------------
    console.log("Navigating to /checkout...");
    await cdp.send("Page.navigate", { url: `${appUrl}/checkout` });
    await sleep(3000);

    // Verify Advance Booking notice
    const advanceNoticeText = await cdp.eval(`
      (() => {
        const alerts = Array.from(document.querySelectorAll('.alert, div'));
        const found = alerts.find(a => a.textContent.includes('Orders must be scheduled at least one day in advance'));
        return found ? found.textContent.trim() : null;
      })()
    `);
    console.log("Advance booking notice present:", advanceNoticeText ? "YES" : "NO");

    // Verify required stars on Name and Phone
    const labelsInfo = await cdp.eval(`
      (() => {
        const nameLabel = document.querySelector('label[for="checkout-name"]')?.textContent || '';
        const phoneLabel = document.querySelector('label[for="checkout-phone"]')?.textContent || '';
        const dateLabel = document.querySelector('label[for="checkout-delivery-date"]')?.textContent || '';
        return { nameLabel, phoneLabel, dateLabel };
      })()
    `);
    console.log("Field labels with mandatory indicators:", labelsInfo);

    // Test responsive viewports
    const viewports = [
      { width: 375, height: 812, name: "375px_mobile_pickup" },
      { width: 430, height: 932, name: "430px_mobile_delivery" },
      { width: 768, height: 1024, name: "768px_tablet" },
      { width: 1366, height: 768, name: "1366px_laptop" },
      { width: 1920, height: 1080, name: "1920px_desktop" },
    ];

    for (const vp of viewports) {
      await cdp.setViewport(vp.width, vp.height);
      if (vp.name.includes("delivery")) {
        // Click Doorstep Delivery
        await cdp.eval(`
          (() => {
            const btns = Array.from(document.querySelectorAll('.fulfillment-option'));
            const delivBtn = btns.find(b => b.textContent.includes('Doorstep Delivery'));
            if (delivBtn) delivBtn.click();
          })()
        `);
      } else {
        // Click Bakery Pickup
        await cdp.eval(`
          (() => {
            const btns = Array.from(document.querySelectorAll('.fulfillment-option'));
            const pickupBtn = btns.find(b => b.textContent.includes('Bakery Counter Pickup'));
            if (pickupBtn) pickupBtn.click();
          })()
        `);
      }
      await sleep(500);
      await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, `checkout_${vp.name}.png`));
    }

    // Reset to 1366x768 for functional flow
    await cdp.setViewport(1366, 768);

    // -------------------------------------------------------------
    // STEP 3: Place First-Time Customer Order (Pickup)
    // -------------------------------------------------------------
    console.log("Placing first-time customer order...");
    await cdp.eval(`
      (() => {
        function setReactInput(el, val) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) {
            setter.call(el, val);
          } else {
            el.value = val;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Select Bakery Pickup
        const btns = Array.from(document.querySelectorAll('.fulfillment-option'));
        const pickupBtn = btns.find(b => b.textContent.includes('Bakery Counter Pickup'));
        if (pickupBtn) pickupBtn.click();

        // Fill Name and Phone
        const nameInput = document.getElementById('checkout-name');
        if (nameInput) setReactInput(nameInput, 'Rohan FirstCustomer');

        const phoneInput = document.getElementById('checkout-phone');
        if (phoneInput) setReactInput(phoneInput, '9876543210');
      })()
    `);
    await sleep(500);

    // Submit Checkout form
    await cdp.eval(`
      (() => {
        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.click();
      })()
    `);

    // Wait for redirection to /payment-upi/...
    await sleep(4000);

    const currentUrl = await cdp.eval("window.location.href");
    console.log("Redirected after first checkout:", currentUrl);
    const checkoutErr = await cdp.eval(`document.querySelector('.alert-danger')?.textContent || null`);
    if (checkoutErr) console.log("First checkout error:", checkoutErr);
    const orderIdMatch = currentUrl.match(/payment-upi\/([a-f\d]{24})/i);
    if (orderIdMatch) {
      createdOrderIds.push(orderIdMatch[1]);
    }

    // -------------------------------------------------------------
    // STEP 4: Verify Payment Page - First-Time Customer Screenshot Mandatory
    // -------------------------------------------------------------
    await sleep(1500);
    // Scroll down to the payment proof form
    await cdp.eval(`window.scrollTo(0, 600);`);
    await sleep(500);
    await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, "payment_first_time_customer_screenshot_required.png"));

    const submitBtnDisabled = await cdp.eval(`
      (() => {
        const btn = document.querySelector('button[type="submit"]');
        return btn ? btn.disabled : null;
      })()
    `);
    console.log("First-time submit button disabled without screenshot:", submitBtnDisabled);

    const firstTimeNotice = await cdp.eval(`
      (() => {
        const alert = document.querySelector('.alert-warning');
        return alert ? alert.textContent.trim() : null;
      })()
    `);
    console.log("First-time customer mandatory screenshot notice:", firstTimeNotice);

    // Submit payment verification with screenshot via client api
    await cdp.eval(`
      (async () => {
        const b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        const orderId = window.location.pathname.split('/').pop();
        const res = await fetch('/api/v1/orders/' + orderId + '/mark-paid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            screenshot: b64,
            mimeType: 'image/png',
            fileName: 'upi_proof.png',
            amount: 150,
            token: token || undefined,
            isReturningCustomer: false
          })
        });
        window.location.reload();
      })()
    `);
    await sleep(3000);

    await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, "payment_pending_verification.png"));

    // -------------------------------------------------------------
    // STEP 5: Returning Customer Flow in the Same Browser
    // -------------------------------------------------------------
    console.log("Testing returning customer flow in the same browser...");
    // Add item to cart again
    await cdp.eval(`
      (async () => {
        const guestId = localStorage.getItem('smart_bakery_guest_id');
        await fetch('/api/v1/cart/items', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-guest-id': guestId,
          },
          body: JSON.stringify({
            productId: "${product._id.toString()}",
            variantId: "${variantId.toString()}",
            quantity: 1,
          })
        });
      })()
    `);

    // Navigate to /checkout
    await cdp.send("Page.navigate", { url: `${appUrl}/checkout` });
    await sleep(3000);

    // Verify "Use Saved Customer Details" banner is rendered and name/phone prefilled
    const savedCustomerBanner = await cdp.eval(`
      (() => {
        const text = document.body.innerText;
        const hasBanner = text.includes('Use Saved Customer Details');
        const nameVal = document.getElementById('checkout-name')?.value;
        const phoneVal = document.getElementById('checkout-phone')?.value;
        return { hasBanner, nameVal, phoneVal };
      })()
    `);
    console.log("Saved customer details banner and pre-fill:", savedCustomerBanner);

    await cdp.eval(`document.getElementById('checkout-name')?.scrollIntoView({ behavior: 'instant', block: 'center' });`);
    await sleep(400);
    await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, "checkout_returning_customer_banner.png"));

    // Place second order
    await cdp.eval(`
      (() => {
        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.click();
      })()
    `);
    await sleep(4000);

    const returningPaymentUrl = await cdp.eval("window.location.href");
    console.log("Returning customer redirected to payment:", returningPaymentUrl);
    const returningErr = await cdp.eval(`document.querySelector('.alert-danger')?.textContent || null`);
    if (returningErr) console.log("Returning customer checkout error:", returningErr);
    const returningOrderIdMatch = returningPaymentUrl.match(/payment-upi\/([a-f\d]{24})/i);
    if (returningOrderIdMatch) {
      createdOrderIds.push(returningOrderIdMatch[1]);
    }

    // Verify Returning Customer Screenshot is OPTIONAL
    await sleep(1500);
    await cdp.eval(`window.scrollTo(0, 600);`);
    await sleep(400);

    const returningNotice = await cdp.eval(`
      (() => {
        const alert = document.querySelector('.alert-info');
        const btn = document.querySelector('button[type="submit"]');
        return {
          alertText: alert ? alert.textContent.trim() : null,
          btnText: btn ? btn.textContent.trim() : null,
          btnDisabled: btn ? btn.disabled : null,
        };
      })()
    `);
    console.log("Returning customer optional screenshot state:", returningNotice);

    await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, "payment_returning_customer_screenshot_optional.png"));

    // Submit payment verification as returning customer without screenshot
    await cdp.eval(`
      (async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        const orderId = window.location.pathname.split('/').pop();
        const res = await fetch('/api/v1/orders/' + orderId + '/mark-paid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: 150,
            token: token || undefined,
            isReturningCustomer: true
          })
        });
        window.location.reload();
      })()
    `);
    await sleep(3000);

    await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, "payment_returning_verified_submitted.png"));

    // -------------------------------------------------------------
    // STEP 6: Owner Dashboard - Orders Active vs Inactive Presentation
    // -------------------------------------------------------------
    console.log("Verifying Owner Dashboard orders view...");
    const ownerToken = generateAccessToken(owner);

    await cdp.eval(`
      (() => {
        localStorage.setItem('smart_bakery_token', "${ownerToken}");
        localStorage.setItem('smart_bakery_user', JSON.stringify({
          _id: "${owner._id.toString()}",
          name: "${owner.name}",
          email: "${owner.email}",
          role: "OWNER_MANAGER"
        }));
      })()
    `);

    await cdp.send("Page.navigate", { url: `${appUrl}/owner` });
    await sleep(3000);

    // Switch to Orders tab if not active
    await cdp.eval(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('button, nav a'));
        const orderTab = tabs.find(t => t.textContent.includes('Orders'));
        if (orderTab) orderTab.click();
      })()
    `);
    await sleep(2000);

    await cdp.captureScreenshot(path.join(SCREENSHOT_DIR, "owner_orders_active_inactive_view.png"));
    console.log("All browser verification steps completed successfully!");
  } finally {
    // Teardown CDP and Chrome
    if (cdp) cdp.close();
    if (chromeProc) {
      try {
        chromeProc.kill("SIGKILL");
      } catch {}
    }
    await sleep(500);

    // Safe fixture cleanup: Delete only the test orders created during this session
    console.log(`Cleaning up ${createdOrderIds.length} test order fixtures...`);
    if (createdOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: createdOrderIds } });
    }
    if (stock) {
      await FinishedProductStock.deleteOne({ _id: stock._id });
    }
    if (product) {
      await Product.deleteOne({ _id: product._id });
    }
    if (category) {
      await Category.deleteOne({ _id: category._id });
    }
    await disconnectDb();
    console.log("Cleanup completed. Database is clean.");
  }
}

runBrowserAudit().catch((err) => {
  console.error("Browser audit error:", err);
  process.exit(1);
});
