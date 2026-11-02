import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9231;
const TEMP_USER_DATA = path.join(os.tmpdir(), `bakery_detail_audit_${Date.now()}`);

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
      const tm = setTimeout(() => rej(new Error("WS timeout")), 5000);
      this.ws.onopen = () => { clearTimeout(tm); res(); };
      this.ws.onerror = (e) => { clearTimeout(tm); rej(e); };
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
      } catch (err) {}
    };
  }

  send(method, params = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      const timer = setTimeout(() => {
        if (this.callbacks.has(msgId)) {
          this.callbacks.delete(msgId);
          reject(new Error(`Timeout ${method}`));
        }
      }, timeoutMs);
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
  await fs.mkdir(TEMP_USER_DATA, { recursive: true });
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (res.ok) break;
      } catch (_) {}
    }

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

    // Add item to cart first
    await cdp.send("Page.navigate", { url: "http://localhost:5173/" });
    await sleep(2000);
    await cdp.eval(`(() => {
      const b = document.querySelector('button.product-add-button, button[aria-label="Add to basket"]');
      if (b) b.click();
    })()`);
    await sleep(1000);

    const testPages = [
      { name: "Home", url: "http://localhost:5173/" },
      { name: "Product Detail", url: "http://localhost:5173/product/6ad477fa00d7d2c05ca919e9" },
      { name: "Cart", url: "http://localhost:5173/cart" },
      { name: "Checkout", url: "http://localhost:5173/checkout" },
      { name: "UPI Payment", url: "http://localhost:5173/payment-upi/6adc4cbb31d2901d988642ac?token=e2e754eb8d797e5081cb935c0ad5db35&orderNumber=ORD-2026-000011" },
      { name: "Track Order", url: "http://localhost:5173/track?orderNumber=ORD-2026-000011&token=e2e754eb8d797e5081cb935c0ad5db35" }
    ];

    const widths = [375, 430];

    for (const w of widths) {
      console.log(`\n========================================`);
      console.log(`Detailed Inspection at Viewport ${w}px`);
      console.log(`========================================`);
      await cdp.setViewport(w, 800);

      for (const p of testPages) {
        await cdp.send("Page.navigate", { url: p.url });
        await sleep(1500);

        const details = await cdp.eval(`(() => {
          const docEl = document.documentElement;
          const winW = window.innerWidth;

          // 1. Check for text truncation where overflow is hidden
          const clippedElements = [];
          const textNodes = document.querySelectorAll('h1, h2, h3, h4, p, span, button, a, label');
          for (const el of textNodes) {
            const style = window.getComputedStyle(el);
            if (style.overflow === 'hidden' && style.textOverflow === 'clip' && el.scrollWidth > el.clientWidth + 2) {
              clippedElements.push({
                text: el.innerText.slice(0, 30),
                tag: el.tagName.toLowerCase(),
                class: el.className
              });
            }
          }

          // 2. Check for small touch targets (buttons/inputs < 30px height)
          const smallTargets = [];
          const interactives = document.querySelectorAll('button, input, select, a.btn');
          for (const el of interactives) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && (r.height < 28 || r.width < 28)) {
              smallTargets.push({
                text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').slice(0, 25),
                width: Math.round(r.width),
                height: Math.round(r.height),
                tag: el.tagName.toLowerCase(),
                id: el.id
              });
            }
          }

          // 3. Check for overlapping interactive elements
          const overlaps = [];
          const btns = Array.from(document.querySelectorAll('button, a.btn, input[type="radio"], input[type="checkbox"]'))
            .filter(b => {
              const r = b.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
            });
          for (let i = 0; i < btns.length; i++) {
            for (let j = i + 1; j < btns.length; j++) {
              const r1 = btns[i].getBoundingClientRect();
              const r2 = btns[j].getBoundingClientRect();
              const isOverlapping = !(r1.right <= r2.left || r1.left >= r2.right || r1.bottom <= r2.top || r1.top >= r2.bottom);
              if (isOverlapping) {
                overlaps.push({
                  b1: (btns[i].innerText || btns[i].getAttribute('aria-label') || btns[i].className).slice(0, 20),
                  b2: (btns[j].innerText || btns[j].getAttribute('aria-label') || btns[j].className).slice(0, 20)
                });
              }
            }
          }

          return {
            title: document.title,
            clippedCount: clippedElements.length,
            clippedElements,
            smallTargetsCount: smallTargets.length,
            smallTargets,
            overlapCount: overlaps.length,
            overlaps
          };
        })()`);

        console.log(`\nPage: ${p.name} (${w}px)`);
        console.log(`- Clipped text elements: ${details.clippedCount}`);
        console.log(`- Small touch targets (<28px): ${details.smallTargetsCount}`);
        if (details.smallTargets.length > 0) {
          console.log(`  Small targets:`, JSON.stringify(details.smallTargets));
        }
        console.log(`- Overlapping controls: ${details.overlapCount}`);
        if (details.overlaps.length > 0) {
          console.log(`  Overlaps:`, JSON.stringify(details.overlaps));
        }
      }
    }

    await cdp.close();
  } finally {
    try { chromeProc.kill("SIGKILL"); } catch (_) {}
    try { await fs.rm(TEMP_USER_DATA, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch(console.error);
