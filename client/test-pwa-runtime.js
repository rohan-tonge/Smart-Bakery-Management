import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('=== STARTING RUNTIME HTTP & SPA ROUTING AUDIT ===\n');

  // Spawn vite preview
  console.log('Spawning Vite preview on port 4173...');
  const viteBin = path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js');
  const previewProcess = spawn(process.execPath, [viteBin, 'preview', '--port', '4173'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  previewProcess.stdout.on('data', (_data) => {
    // console.log('[Vite Preview]', _data.toString().trim());
  });
  previewProcess.stderr.on('data', (d) => {
    console.error('[Vite Preview Err]', d.toString().trim());
  });

  // Wait for preview to be ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetchUrl('http://localhost:4173/');
      if (res.statusCode === 200) {
        ready = true;
        break;
      }
    } catch {
      await wait(300);
    }
  }

  if (!ready) {
    previewProcess.kill();
    throw new Error('Vite preview failed to start on port 4173');
  }
  console.log('✔ Vite preview is active on http://localhost:4173\n');

  try {
    // 1. Verify Manifest HTTP serving
    console.log('[Check 1] HTTP fetch /manifest.webmanifest:');
    const manifestRes = await fetchUrl('http://localhost:4173/manifest.webmanifest');
    assert.equal(manifestRes.statusCode, 200, 'manifest.webmanifest status must be 200');
    console.log(`  ✔ Status 200 OK | Content-Type: ${manifestRes.headers['content-type']}`);
    const parsedManifest = JSON.parse(manifestRes.body);
    assert.equal(parsedManifest.short_name, 'Smart Bakery');

    // 2. Verify Service Worker HTTP serving
    console.log('[Check 2] HTTP fetch /sw.js:');
    const swRes = await fetchUrl('http://localhost:4173/sw.js');
    assert.equal(swRes.statusCode, 200, 'sw.js status must be 200');
    console.log(`  ✔ Status 200 OK | Content-Type: ${swRes.headers['content-type']}`);
    assert.ok(swRes.body.includes('precacheAndRoute'));

    // 3. Verify Icons HTTP serving
    console.log('[Check 3] HTTP fetch declared icons:');
    const icons = [
      '/pwa-192x192.png',
      '/pwa-512x512.png',
      '/pwa-maskable-192x192.png',
      '/pwa-maskable-512x512.png',
      '/apple-touch-icon.png',
      '/favicon.svg',
      '/favicon-32x32.png',
      '/favicon-16x16.png',
    ];
    for (const icon of icons) {
      const res = await fetchUrl(`http://localhost:4173${icon}`);
      assert.equal(res.statusCode, 200, `Icon ${icon} must return 200`);
      console.log(`  ✔ ${icon} -> 200 OK (${res.headers['content-type']})`);
    }

    // 4. Verify SPA Nested Route Fallback on direct navigation/refresh
    console.log('[Check 4] HTTP direct fetch of nested client routes (SPA fallback):');
    const nestedRoutes = ['/cart', '/checkout', '/track', '/owner', '/production', '/login', '/register'];
    for (const route of nestedRoutes) {
      const res = await fetchUrl(`http://localhost:4173${route}`);
      assert.equal(res.statusCode, 200, `Route ${route} direct refresh must return 200`);
      assert.ok(res.body.includes('<div id="root"></div>'), `Route ${route} must serve index.html for SPA router`);
      console.log(`  ✔ Route ${route} -> 200 OK (served index.html without 404)`);
    }

    console.log('\nAll HTTP and SPA routing checks passed successfully!');
  } finally {
    console.log('Stopping preview server...');
    previewProcess.kill();
    try {
      process.kill(previewProcess.pid);
    } catch {}
  }
}

run().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
