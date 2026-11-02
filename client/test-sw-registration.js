import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function sendWs(wsUrl, message) {
  return new Promise((resolve, reject) => {
    // We can use standard global WebSocket in Node 22+
    const ws = new globalThis.WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify(message));
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id === message.id) {
        ws.close();
        resolve(data.result);
      }
    };
    ws.onerror = reject;
  });
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  console.log('=== SERVICE WORKER REGISTRATION & STANDALONE BROWSER TEST ===\n');

  // Start Vite preview
  const viteBin = path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js');
  const preview = spawn(process.execPath, [viteBin, 'preview', '--port', '4173'], {
    cwd: __dirname,
    stdio: 'ignore',
  });

  await wait(1200);

  // Start Chrome with remote debugging
  const chromeUserDataDir = path.join(__dirname, '.chrome-test-profile');
  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      `--user-data-dir=${chromeUserDataDir}`,
      'http://localhost:4173/',
    ],
    { stdio: 'ignore' }
  );

  try {
    // Wait for Chrome debugging port to open
    let targets = null;
    for (let i = 0; i < 20; i++) {
      try {
        targets = await fetchJson('http://localhost:9222/json');
        if (targets && targets.length > 0) break;
      } catch {
        await wait(300);
      }
    }

    assert.ok(targets && targets.length > 0, 'Chrome remote debugging targets found');
    const pageTarget = targets.find((t) => t.type === 'page');
    assert.ok(pageTarget, 'Page target must exist');
    console.log('✔ Connected to Chrome CDP target:', pageTarget.webSocketDebuggerUrl);

    // Wait for page to finish loading and register SW
    await wait(2500);

    // Evaluate Service Worker registration in the page
    console.log('Querying navigator.serviceWorker.getRegistration()...');
    const swResult = await sendWs(pageTarget.webSocketDebuggerUrl, {
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          (async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) return { registered: false };
            return {
              registered: true,
              scope: reg.scope,
              active: Boolean(reg.active),
              activeState: reg.active ? reg.active.state : null,
              installing: Boolean(reg.installing),
              waiting: Boolean(reg.waiting)
            };
          })()
        `,
        awaitPromise: true,
        returnByValue: true,
      },
    });

    console.log('  SW registration details:', swResult?.result?.value);
    assert.ok(swResult?.result?.value?.registered, 'Service worker must be registered in browser');
    assert.ok(swResult?.result?.value?.scope.includes('4173/'), 'Service worker scope must cover root /');
    console.log('  ✔ Service Worker successfully registered in real browser runtime!');

    // Evaluate Standalone Display Mode query
    console.log('Querying matchMedia for standalone display mode support...');
    const mediaResult = await sendWs(pageTarget.webSocketDebuggerUrl, {
      id: 2,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          (() => {
            return {
              hasBeforeInstallPrompt: 'onbeforeinstallprompt' in window,
              hasServiceWorker: 'serviceWorker' in navigator,
              displayMode: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
              manifestLink: document.querySelector('link[rel="manifest"]')?.href
            };
          })()
        `,
        returnByValue: true,
      },
    });

    console.log('  Browser capabilities:', mediaResult?.result?.value);
    assert.ok(mediaResult?.result?.value?.hasServiceWorker, 'serviceWorker must be supported');
    assert.ok(mediaResult?.result?.value?.manifestLink.includes('manifest.webmanifest'), 'Manifest link present');
    console.log('  ✔ PWA features, manifest link, and service worker verified in Chrome engine!');

    console.log('\n=== ALL BROWSER RUNTIME VERIFICATIONS PASSED ===');
  } finally {
    try {
      chrome.kill();
      preview.kill();
      process.kill(chrome.pid);
      process.kill(preview.pid);
    } catch {}
  }
}

run().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
