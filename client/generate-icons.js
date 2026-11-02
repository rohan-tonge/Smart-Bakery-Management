import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const standardSvg = fs.readFileSync(path.join(publicDir, 'bakery-icon.svg'), 'utf-8');
const maskableSvg = fs.readFileSync(path.join(publicDir, 'bakery-icon-maskable.svg'), 'utf-8');
const faviconSvg = fs.readFileSync(path.join(publicDir, 'favicon.svg'), 'utf-8');

const targets = [
  { file: 'pwa-192x192.png', svg: standardSvg, size: 192 },
  { file: 'pwa-512x512.png', svg: standardSvg, size: 512 },
  { file: 'pwa-maskable-192x192.png', svg: maskableSvg, size: 192 },
  { file: 'pwa-maskable-512x512.png', svg: maskableSvg, size: 512 },
  { file: 'apple-touch-icon.png', svg: standardSvg, size: 180 },
  { file: 'favicon-32x32.png', svg: faviconSvg, size: 32 },
  { file: 'favicon-16x16.png', svg: faviconSvg, size: 16 },
];

for (const target of targets) {
  const resvg = new Resvg(target.svg, {
    fitTo: {
      mode: 'width',
      value: target.size,
    },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  fs.writeFileSync(path.join(publicDir, target.file), pngBuffer);
  console.log(`Generated ${target.file} (${target.size}x${target.size}) - ${pngBuffer.length} bytes`);
}
