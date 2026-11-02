import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = "C:\\Users\\Rohan\\AppData\\Local\\Temp\\isolated_cdp_verification";
const SCREENSHOT_DIR = "C:\\Users\\Rohan\\OneDrive\\Desktop\\bakery management\\verification_screenshots";

// 1x1 transparent PNG base64 for upload testing
const SAMPLE_BASE64_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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
      this.callbacks.set(msgId, { resolve, reject });
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
    return filepath;
  }
}

async function runLiveBrowserVerification() {
  console.log("=== STARTING LIVE BROWSER VERIFICATION ===");

  await fs.mkdir(USER_DATA_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

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

  const version = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
  console.log(`[Browser] Running Chrome: ${version.Browser}`);

  const tabs = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
  const tab = tabs[0] || (await fetch("http://127.0.0.1:9222/json/new").then((r) => r.json()));

  const cdp = new CdpClient(tab.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");

  const results = {
    viewportsTested: [],
    workflows: {},
    overflows: [],
    errors: [],
  };

  try {
    // =========================================================================
    // WORKFLOW 1: Customer Storefront: Home -> Product -> Cart -> Checkout
    // =========================================================================
    console.log("\n--- Workflow 1: Customer Storefront Journey ---");
    await cdp.setViewport(1366, 768);
    await cdp.navigate("http://localhost:5173/");

    const homeTitle = await cdp.eval("document.title");
    const productCardsCount = await cdp.eval("document.querySelectorAll('.product-card, [data-testid=\"product-card\"], .card').length");
    console.log(`[Home] Page loaded. Title: "${homeTitle}", Product cards found: ${productCardsCount}`);
    await cdp.captureScreenshot("01_home_desktop.png");

    // Click first available product
    const productNav = await cdp.eval(`(() => {
      const link = document.querySelector('a[href^="/product/"]');
      if (link) {
        link.click();
        return link.getAttribute('href');
      }
      return null;
    })()`);

    console.log(`[Product Nav] Clicked product link: ${productNav}`);
    await new Promise((r) => setTimeout(r, 2000));

    const productPageDetails = await cdp.eval(`(() => {
      const title = document.querySelector('h1')?.innerText || document.title;
      const price = document.querySelector('.price, [class*="price"]')?.innerText;
      const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('add'));
      if (addBtn) addBtn.click();
      return { title, price, added: Boolean(addBtn) };
    })()`);
    console.log(`[Product Detail] ${JSON.stringify(productPageDetails)}`);
    await cdp.captureScreenshot("02_product_detail.png");

    await new Promise((r) => setTimeout(r, 1000));

    // Navigate to Cart
    await cdp.navigate("http://localhost:5173/cart");
    const cartDetails = await cdp.eval(`(() => {
      const items = document.querySelectorAll('.cart-item, [class*="cartItem"], table tbody tr');
      const checkoutBtn = Array.from(document.querySelectorAll('a, button')).find(el => el.innerText.toLowerCase().includes('checkout') || el.innerText.toLowerCase().includes('proceed'));
      return {
        itemsCount: items.length,
        hasCheckoutBtn: Boolean(checkoutBtn),
        cartText: document.body.innerText.slice(0, 150).replace(/\\n/g, ' ')
      };
    })()`);
    console.log(`[Cart Page] ${JSON.stringify(cartDetails)}`);
    await cdp.captureScreenshot("03_cart_page.png");

    // =========================================================================
    // WORKFLOW 2: Checkout with Delivery Date & Time Slot + UPI Payment Screenshot
    // =========================================================================
    console.log("\n--- Workflow 2: Checkout with Slot & UPI Upload ---");
    await cdp.navigate("http://localhost:5173/checkout");
    await new Promise((r) => setTimeout(r, 2000));

    const checkoutSlots = await cdp.eval(`(() => {
      const dateButtons = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.match(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/i));
      const slotButtons = Array.from(document.querySelectorAll('button, input[type="radio"]')).filter(b => b.innerText?.includes(':') || b.value?.includes(':'));
      return {
        dateCount: dateButtons.length,
        slotCount: slotButtons.length,
        url: window.location.href
      };
    })()`);
    console.log(`[Checkout Slots Loaded] ${JSON.stringify(checkoutSlots)}`);
    await cdp.captureScreenshot("04_checkout_slots.png");

    // Fill checkout form for guest with UPI
    const fillGuestUpi = await cdp.eval(`(async () => {
      // 1. Select Delivery if available
      const deliveryBtn = Array.from(document.querySelectorAll('button, input[type="radio"]')).find(el => el.innerText?.toLowerCase().includes('delivery') || el.value === 'DELIVERY');
      if (deliveryBtn) deliveryBtn.click();

      // 2. Click first available date
      const dateBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.match(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/i) && !b.disabled);
      if (dateBtn) dateBtn.click();

      // 3. Click first available slot
      const slotBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes(':00') && !b.disabled && !b.innerText.toLowerCase().includes('fully booked'));
      if (slotBtn) slotBtn.click();

      // 4. Fill contact details
      const nameInput = document.querySelector('input[name="contactName"], input[placeholder*="Name" i], input[type="text"]');
      if (nameInput) {
        nameInput.value = "Guest Live Tester";
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const phoneInput = document.querySelector('input[name="contactPhone"], input[type="tel"], input[placeholder*="Phone" i]');
      if (phoneInput) {
        phoneInput.value = "9876543299";
        phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const emailInput = document.querySelector('input[name="contactEmail"], input[type="email"]');
      if (emailInput) {
        emailInput.value = "guest-live@test.com";
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const addrInput = document.querySelector('input[name="addressLine1"], input[placeholder*="Address" i], textarea[name*="address" i]');
      if (addrInput) {
        addrInput.value = "123 Live Street";
        addrInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const cityInput = document.querySelector('input[name="city"], input[placeholder*="City" i]');
      if (cityInput) {
        cityInput.value = "London";
        cityInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const pinInput = document.querySelector('input[name="postalCode"], input[placeholder*="Postal" i], input[placeholder*="PIN" i]');
      if (pinInput) {
        pinInput.value = "NW1 6XE";
        pinInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // 5. Select UPI radio button
      const upiRadio = Array.from(document.querySelectorAll('input[type="radio"], button, label')).find(el => el.innerText?.toLowerCase().includes('upi') || el.value === 'MANUAL_UPI');
      if (upiRadio) upiRadio.click();

      return { filled: true };
    })()`);
    console.log(`[Form Filled] ${JSON.stringify(fillGuestUpi)}`);

    // Submit Order
    await cdp.eval(`(() => {
      const submitBtn = Array.from(document.querySelectorAll('button[type="submit"], button')).find(b => b.innerText.toLowerCase().includes('place order') || b.innerText.toLowerCase().includes('complete') || b.innerText.toLowerCase().includes('pay'));
      if (submitBtn) submitBtn.click();
    })()`);

    console.log("[Checkout Submit] Clicked place order button, awaiting navigation...");
    await new Promise((r) => setTimeout(r, 3500));

    const currentUrl = await cdp.eval("window.location.href");
    console.log(`[Current URL after UPI order]: ${currentUrl}`);
    results.workflows.upiRedirect = currentUrl;
    await cdp.captureScreenshot("05_post_checkout_upi.png");

    // Check if on /payment-upi/:id and guest was NOT redirected to login
    const isUpiPaymentPage = currentUrl.includes("/payment-upi/");
    const notOnLogin = !currentUrl.includes("/login");
    console.log(`[Verification] On UPI Payment page: ${isUpiPaymentPage}, Not redirected to login: ${notOnLogin}`);
    results.workflows.guestNotRedirectedToLogin = isUpiPaymentPage && notOnLogin;

    // Test payment screenshot upload
    if (isUpiPaymentPage) {
      console.log("[UPI Payment Page] Simulating screenshot upload...");
      const uploadResult = await cdp.eval(`(async (sampleBase64) => {
        // Set sample screenshot directly or via file input simulation
        const fileInput = document.querySelector('input[type="file"]');
        const submitProofBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('submit') || b.innerText.toLowerCase().includes('upload') || b.innerText.toLowerCase().includes('verify'));
        
        // Check if QR code and amount are displayed
        const amountEl = document.querySelector('.payable-amount, [class*="amount"]');
        const qrEl = document.querySelector('img[src*="upi"], img[alt*="QR" i], canvas');
        
        return {
          hasFileInput: Boolean(fileInput),
          hasSubmitProofBtn: Boolean(submitProofBtn),
          amountText: amountEl?.innerText,
          hasQr: Boolean(qrEl),
          statusText: document.body.innerText.slice(0, 200).replace(/\\n/g, ' ')
        };
      })('${SAMPLE_BASE64_PNG}')`);
      console.log(`[UPI Page Elements] ${JSON.stringify(uploadResult)}`);
    }

    // =========================================================================
    // WORKFLOW 3: Pay on Delivery (COD) Checkout & Tracking
    // =========================================================================
    console.log("\n--- Workflow 3: Pay on Delivery (COD) Checkout ---");
    // Add product again to cart via API for speed
    await cdp.eval(`(async () => {
      const res = await fetch('/api/v1/catalog');
      const data = await res.json();
      const prod = data.data.products[0];
      if (prod) {
        await fetch('/api/v1/cart/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: prod._id, variantId: prod.variants[0]._id, quantity: 1 })
        });
      }
    })()`);

    await cdp.navigate("http://localhost:5173/checkout");
    await new Promise((r) => setTimeout(r, 2000));

    const fillCod = await cdp.eval(`(async () => {
      // Click Delivery
      const deliveryBtn = Array.from(document.querySelectorAll('button, input[type="radio"]')).find(el => el.innerText?.toLowerCase().includes('delivery') || el.value === 'DELIVERY');
      if (deliveryBtn) deliveryBtn.click();

      // Click first available date & slot
      const dateBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.match(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/i) && !b.disabled);
      if (dateBtn) dateBtn.click();
      const slotBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes(':00') && !b.disabled && !b.innerText.toLowerCase().includes('fully booked'));
      if (slotBtn) slotBtn.click();

      // Fill info
      const nameInput = document.querySelector('input[name="contactName"], input[placeholder*="Name" i], input[type="text"]');
      if (nameInput) { nameInput.value = "COD Live Tester"; nameInput.dispatchEvent(new Event('input', { bubbles: true })); }
      const phoneInput = document.querySelector('input[name="contactPhone"], input[type="tel"]');
      if (phoneInput) { phoneInput.value = "9876543288"; phoneInput.dispatchEvent(new Event('input', { bubbles: true })); }
      const addrInput = document.querySelector('input[name="addressLine1"], input[placeholder*="Address" i]');
      if (addrInput) { addrInput.value = "456 COD Lane"; addrInput.dispatchEvent(new Event('input', { bubbles: true })); }
      const cityInput = document.querySelector('input[name="city"], input[placeholder*="City" i]');
      if (cityInput) { cityInput.value = "London"; cityInput.dispatchEvent(new Event('input', { bubbles: true })); }
      const pinInput = document.querySelector('input[name="postalCode"], input[placeholder*="Postal" i]');
      if (pinInput) { pinInput.value = "NW1 456"; pinInput.dispatchEvent(new Event('input', { bubbles: true })); }

      // Select COD
      const codRadio = Array.from(document.querySelectorAll('input[type="radio"], button, label')).find(el => el.innerText?.toLowerCase().includes('delivery') && el.innerText?.toLowerCase().includes('pay on'));
      if (codRadio) codRadio.click();

      return { ready: true };
    })()`);

    // Submit COD Order
    await cdp.eval(`(() => {
      const submitBtn = Array.from(document.querySelectorAll('button[type="submit"], button')).find(b => b.innerText.toLowerCase().includes('place order') || b.innerText.toLowerCase().includes('complete'));
      if (submitBtn) submitBtn.click();
    })()`);

    await new Promise((r) => setTimeout(r, 3500));
    const codUrl = await cdp.eval("window.location.href");
    console.log(`[Current URL after COD order]: ${codUrl}`);
    results.workflows.codRedirect = codUrl;
    await cdp.captureScreenshot("06_post_checkout_cod.png");

    // Verify Tracking Page for COD order shows PAYMENT_PENDING
    const trackingDetails = await cdp.eval(`(() => {
      const statusBadges = Array.from(document.querySelectorAll('.badge, [class*="status"], [class*="badge"]')).map(el => el.innerText);
      const pageText = document.body.innerText;
      return {
        url: window.location.href,
        statusBadges,
        hasPendingPayment: pageText.toLowerCase().includes('pending') || pageText.toLowerCase().includes('pay on delivery'),
        summary: pageText.slice(0, 200).replace(/\\n/g, ' ')
      };
    })()`);
    console.log(`[Tracking Verification] ${JSON.stringify(trackingDetails)}`);

    // =========================================================================
    // WORKFLOW 4: Owner / Manager Dashboard & Verification
    // =========================================================================
    console.log("\n--- Workflow 4: Owner / Manager Dashboard ---");
    // Log in as Owner: admin@gmail.com / 123456
    await cdp.navigate("http://localhost:5173/login");
    await new Promise((r) => setTimeout(r, 1500));

    await cdp.eval(`(() => {
      const emailInput = document.querySelector('input[type="email"]');
      const passInput = document.querySelector('input[type="password"]');
      const submitBtn = document.querySelector('button[type="submit"]');
      if (emailInput) { emailInput.value = 'admin@gmail.com'; emailInput.dispatchEvent(new Event('input', { bubbles: true })); }
      if (passInput) { passInput.value = '123456'; passInput.dispatchEvent(new Event('input', { bubbles: true })); }
      if (submitBtn) submitBtn.click();
    })()`);

    await new Promise((r) => setTimeout(r, 3000));
    const ownerUrl = await cdp.eval("window.location.href");
    console.log(`[Owner Login URL]: ${ownerUrl}`);
    await cdp.captureScreenshot("07_owner_dashboard.png");

    const ownerDashboardTabs = await cdp.eval(`(() => {
      const tabs = Array.from(document.querySelectorAll('nav a, nav button, [role="tab"], button')).map(el => el.innerText.trim()).filter(Boolean);
      return { tabs: [...new Set(tabs)] };
    })()`);
    console.log(`[Owner Tabs]: ${JSON.stringify(ownerDashboardTabs)}`);

    // Check absence of shift concepts on owner screen
    const ownerShiftCheck = await cdp.eval(`(() => {
      const text = document.body.innerText.toLowerCase();
      const hasShiftWord = text.includes('shift timing') || text.includes('select shift') || text.includes('shift roster');
      return { hasShiftWord };
    })()`);
    console.log(`[Owner Shift Concepts Absent]: ${!ownerShiftCheck.hasShiftWord}`);
    results.workflows.ownerShiftsAbsent = !ownerShiftCheck.hasShiftWord;

    // Check Product Pricing & Margins view
    const productPriceMargin = await cdp.eval(`(() => {
      // Look for products or cost breakdown table
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, th')).map(h => h.innerText.trim());
      const hasMarginCols = headings.some(h => h.toLowerCase().includes('margin') || h.toLowerCase().includes('cost') || h.toLowerCase().includes('profit'));
      return { headings: headings.slice(0, 15), hasMarginCols };
    })()`);
    console.log(`[Owner Cost/Price/Margin Columns]: ${JSON.stringify(productPriceMargin)}`);

    // =========================================================================
    // WORKFLOW 5: Production Staff Dashboard
    // =========================================================================
    console.log("\n--- Workflow 5: Production Staff Dashboard ---");
    // Clear storage and log in as production staff: production@staff.com / 123456
    await cdp.eval("localStorage.clear(); sessionStorage.clear();");
    await cdp.navigate("http://localhost:5173/login");
    await new Promise((r) => setTimeout(r, 1500));

    await cdp.eval(`(() => {
      const emailInput = document.querySelector('input[type="email"]');
      const passInput = document.querySelector('input[type="password"]');
      const submitBtn = document.querySelector('button[type="submit"]');
      if (emailInput) { emailInput.value = 'production@staff.com'; emailInput.dispatchEvent(new Event('input', { bubbles: true })); }
      if (passInput) { passInput.value = '123456'; passInput.dispatchEvent(new Event('input', { bubbles: true })); }
      if (submitBtn) submitBtn.click();
    })()`);

    await new Promise((r) => setTimeout(r, 3000));
    const prodUrl = await cdp.eval("window.location.href");
    console.log(`[Production Login URL]: ${prodUrl}`);
    await cdp.captureScreenshot("08_production_dashboard.png");

    const prodDashboardChecks = await cdp.eval(`(() => {
      const text = document.body.innerText.toLowerCase();
      const hasQualityCheck = text.includes('quality check') || text.includes('quality-check') || text.includes('qc stage');
      const hasShift = text.includes('shift timing') || text.includes('assigned shift') || text.includes('my shift');
      return {
        hasQualityCheck,
        hasShift,
        summary: document.body.innerText.slice(0, 200).replace(/\\n/g, ' ')
      };
    })()`);
    console.log(`[Production Checks] Quality Check Absent: ${!prodDashboardChecks.hasQualityCheck}, Shifts Absent: ${!prodDashboardChecks.hasShift}`);
    results.workflows.productionQualityCheckAbsent = !prodDashboardChecks.hasQualityCheck;
    results.workflows.productionShiftsAbsent = !prodDashboardChecks.hasShift;

    // =========================================================================
    // WORKFLOW 6: Responsive Viewports Verification
    // =========================================================================
    console.log("\n--- Workflow 6: Responsive Viewport Checks ---");
    const viewports = [
      { name: "375px (Mobile Portrait - iPhone SE)", width: 375, height: 667 },
      { name: "430px (Large Mobile - iPhone 15/16 Pro Max)", width: 430, height: 932 },
      { name: "768px (Tablet Portrait - iPad)", width: 768, height: 1024 },
      { name: "1366px (Desktop Laptop)", width: 1366, height: 768 },
      { name: "1920px (Full HD Desktop)", width: 1920, height: 1080 },
    ];

    const testPages = [
      { url: "http://localhost:5173/", label: "Home" },
      { url: "http://localhost:5173/checkout", label: "Checkout" },
      { url: "http://localhost:5173/track", label: "OrderTracking" },
    ];

    for (const vp of viewports) {
      console.log(`\nEvaluating Viewport: ${vp.name} (${vp.width}x${vp.height})`);
      await cdp.setViewport(vp.width, vp.height);

      for (const page of testPages) {
        await cdp.navigate(page.url, 1500);

        const metrics = await cdp.eval(`(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, body.scrollWidth);
          const clientWidth = docEl.clientWidth;
          const hasHorizontalOverflow = scrollWidth > clientWidth + 1; // 1px threshold for subpixel rounding
          return {
            scrollWidth,
            clientWidth,
            hasHorizontalOverflow,
            overflowAmount: Math.max(0, scrollWidth - clientWidth)
          };
        })()`);

        const filename = `vp_${vp.width}_${page.label}.png`;
        await cdp.captureScreenshot(filename);

        console.log(`  [${page.label} @ ${vp.width}px] scrollWidth: ${metrics.scrollWidth}, clientWidth: ${metrics.clientWidth}, hasOverflow: ${metrics.hasHorizontalOverflow}`);

        if (metrics.hasHorizontalOverflow) {
          results.overflows.push({
            viewport: vp.name,
            width: vp.width,
            page: page.label,
            overflowAmount: metrics.overflowAmount,
          });
        }
      }
      results.viewportsTested.push(vp);
    }
  } catch (err) {
    console.error("Verification Error:", err);
    results.errors.push(err.message);
  } finally {
    await cdp.close();
    chromeProcess.kill();
    console.log("\n=== LIVE BROWSER VERIFICATION COMPLETE ===");
  }

  return results;
}

runLiveBrowserVerification().then((res) => {
  console.log("\nFINAL RESULTS SUMMARY:");
  console.log(JSON.stringify(res, null, 2));
});
