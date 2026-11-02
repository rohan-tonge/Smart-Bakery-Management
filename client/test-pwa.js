import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');

console.log('=== PWA AUDIT AND VERIFICATION SUITE ===\n');

// 1. Audit Manifest
console.log('[Test 1] Inspecting dist/manifest.webmanifest...');
const manifestPath = path.join(distDir, 'manifest.webmanifest');
assert.ok(fs.existsSync(manifestPath), 'manifest.webmanifest must exist in dist');
const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

assert.equal(manifestContent.name, 'Smart Bakery Management System');
assert.equal(manifestContent.short_name, 'Smart Bakery');
assert.equal(manifestContent.description, 'Order bakery products and manage bakery operations with Smart Bakery.');
assert.equal(manifestContent.start_url, '/');
assert.equal(manifestContent.scope, '/');
assert.equal(manifestContent.display, 'standalone');
assert.equal(manifestContent.theme_color, '#ea580c');
assert.equal(manifestContent.background_color, '#fbf9f6');
assert.equal(manifestContent.orientation, 'any');
assert.equal(manifestContent.lang, 'en');
assert.ok(Array.isArray(manifestContent.icons) && manifestContent.icons.length >= 4, 'Must have at least 4 icons');
assert.ok(Array.isArray(manifestContent.shortcuts) && manifestContent.shortcuts.length >= 3, 'Must have shortcuts');
console.log('  ✔ Manifest has all required fields, valid JSON, and proper metadata');

// 2. Audit All Declared Icons
console.log('[Test 2] Auditing declared icons and image files...');
for (const icon of manifestContent.icons) {
  const iconPath = path.join(distDir, icon.src.replace(/^\//, ''));
  assert.ok(fs.existsSync(iconPath), `Icon file ${icon.src} must exist in dist`);
  const stats = fs.statSync(iconPath);
  assert.ok(stats.size > 500, `Icon file ${icon.src} must not be empty (size: ${stats.size} bytes)`);
  // Verify PNG header signature (89 50 4E 47 0D 0A 1A 0A)
  const buf = fs.readFileSync(iconPath);
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);
  assert.equal(buf[2], 0x4e);
  assert.equal(buf[3], 0x47);
  console.log(`  ✔ Icon ${icon.src} (${icon.sizes}, purpose: ${icon.purpose}) verified (${stats.size} bytes)`);
}

// Check Apple touch icon and favicon
const appleTouchPath = path.join(distDir, 'apple-touch-icon.png');
assert.ok(fs.existsSync(appleTouchPath), 'apple-touch-icon.png must exist');
const faviconSvgPath = path.join(distDir, 'favicon.svg');
assert.ok(fs.existsSync(faviconSvgPath), 'favicon.svg must exist');
console.log('  ✔ Apple touch icon and favicon verified');

// 3. Audit Service Worker & Caching Safety
console.log('[Test 3] Auditing service worker and caching safety...');
const swPath = path.join(distDir, 'sw.js');
assert.ok(fs.existsSync(swPath), 'sw.js must exist in dist');
const swContent = fs.readFileSync(swPath, 'utf-8');

// Verify Workbox precache
assert.ok(swContent.includes('precacheAndRoute'), 'Must contain precacheAndRoute');
assert.ok(swContent.includes('NavigationRoute'), 'Must contain NavigationRoute for SPA fallback');
assert.ok(swContent.includes('/^\\/api\\//') || swContent.includes('/api/'), 'NavigationRoute must have denylist for /api/');

// Verify SAFE runtime caching - strictly public catalog only, never sensitive routes
assert.ok(swContent.includes('bakery-catalog-cache'), 'Must contain bakery-catalog-cache for public catalog');
assert.ok(swContent.includes('NetworkFirst'), 'Public catalog must use NetworkFirst');

// Verify sensitive routes are NOT cached
const prohibitedRoutes = [
  '/api/v1/auth',
  '/api/v1/orders',
  '/api/v1/cart',
  '/api/v1/payments',
  '/api/v1/production',
  '/api/v1/inventory',
  '/api/v1/workers',
  '/api/v1/analytics',
  '/api/v1/settings',
];
for (const route of prohibitedRoutes) {
  assert.ok(
    !swContent.includes(`cacheName:"${route}`) && !swContent.includes(`"${route}"`),
    `Sensitive route ${route} must NEVER be cached in service worker`
  );
}
console.log('  ✔ Service worker precaches app shell and protects sensitive endpoints from unsafe caching');

// 4. Audit index.html PWA tags
console.log('[Test 4] Auditing index.html meta tags...');
const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
assert.ok(indexHtml.includes('manifest.webmanifest'), 'index.html must reference manifest.webmanifest');
assert.ok(indexHtml.includes('name="theme-color" content="#ea580c"'), 'index.html must define theme-color');
assert.ok(indexHtml.includes('name="apple-mobile-web-app-capable" content="yes"'), 'index.html must have apple-mobile-web-app-capable');
assert.ok(indexHtml.includes('name="apple-mobile-web-app-status-bar-style"'), 'index.html must have apple-mobile-web-app-status-bar-style');
assert.ok(indexHtml.includes('apple-touch-icon.png'), 'index.html must link apple-touch-icon');
assert.ok(indexHtml.includes('viewport-fit=cover'), 'index.html must support viewport-fit=cover');
console.log('  ✔ index.html contains all mobile & PWA metadata tags');

console.log('\nAll static checks passed! Now testing HTTP responses & SPA routing via Vite preview...');
