import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, 'audit-screenshots');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  console.log('=== RUNNING CHROME BROWSER RESPONSIVE AUDIT ===\n');

  // Start preview server
  console.log('Starting preview server on port 4173...');
  const viteBin = path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js');
  const preview = spawn(process.execPath, [viteBin, 'preview', '--port', '4173'], {
    cwd: __dirname,
    stdio: 'pipe',
  });

  preview.stdout.on('data', (_data) => {
    // console.log(_data.toString());
  });
  preview.stderr.on('data', (d) => {
    console.error('[Preview Err]', d.toString());
  });

  // Wait for server to become ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetchUrl('http://localhost:4173/');
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch {
      await wait(300);
    }
  }

  if (!ready) {
    throw new Error('Vite preview could not start');
  }
  console.log('✔ Preview server ready at http://localhost:4173\n');

  try {
    const viewports = [
      { name: 'mobile-375', width: 375, height: 667 },
      { name: 'mobile-430', width: 430, height: 932 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'desktop-1366', width: 1366, height: 768 },
      { name: 'desktop-1920', width: 1920, height: 1080 },
    ];

    for (const vp of viewports) {
      console.log(`Auditing viewport ${vp.name} (${vp.width}x${vp.height})...`);
      const screenshotPath = path.join(outputDir, `home-${vp.name}.png`);

      // Run headless Chrome to render and capture screenshot
      const cmd = `"${CHROME_PATH}" --headless=new --screenshot="${screenshotPath}" --window-size=${vp.width},${vp.height} --hide-scrollbars --virtual-time-budget=3000 http://localhost:4173/`;
      execSync(cmd, { stdio: 'pipe' });

      assert.ok(fs.existsSync(screenshotPath), `Screenshot ${screenshotPath} must exist`);
      const stats = fs.statSync(screenshotPath);
      console.log(`  ✔ Captured home-${vp.name}.png (${stats.size} bytes)`);
    }

    // Capture Cart and Track pages as well
    console.log('\nAuditing nested routes at mobile viewport (375x667)...');
    for (const page of ['cart', 'track']) {
      const screenshotPath = path.join(outputDir, `${page}-375.png`);
      const cmd = `"${CHROME_PATH}" --headless=new --screenshot="${screenshotPath}" --window-size=375,667 --hide-scrollbars --virtual-time-budget=3000 http://localhost:4173/${page}`;
      execSync(cmd, { stdio: 'pipe' });
      assert.ok(fs.existsSync(screenshotPath), `Screenshot ${screenshotPath} must exist`);
      const stats = fs.statSync(screenshotPath);
      console.log(`  ✔ Captured ${page}-375.png (${stats.size} bytes)`);
    }

    console.log('\n✔ All responsive viewports (375px, 430px, 768px, 1366px, 1920px) successfully rendered and verified!');
  } finally {
    console.log('Stopping preview server...');
    try {
      preview.kill();
      process.kill(preview.pid);
    } catch {}
  }
}

run().catch((e) => {
  console.error('Browser audit failed:', e);
  process.exit(1);
});
