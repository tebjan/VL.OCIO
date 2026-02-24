/**
 * Generates the OG preview image (1200×630 JPEG) for pipeline-checker.
 *
 * Renders a proper HTML/CSS overlay on the clean screenshot via Playwright,
 * so we get real border-radius, fonts, gradients — not ffmpeg drawtext.
 *
 * Usage:  npm run generate-og
 * Output: public/og-image.jpg  (copy to dist/ manually or run generate-og:deploy)
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '..', 'public');
const distDir   = resolve(__dirname, '..', 'dist');
const cleanImg  = resolve(publicDir, 'og-image-clean.jpg');
const outPublic = resolve(publicDir, 'og-image.jpg');
const outDist   = resolve(distDir,   'og-image.jpg');

if (!existsSync(cleanImg)) {
  console.error(`Source image not found: ${cleanImg}`);
  process.exit(1);
}

// Embed as base64 data URL — file:// is blocked in Playwright's sandbox
const imgBase64 = readFileSync(cleanImg).toString('base64');
const bgUrl = `data:image/jpeg;base64,${imgBase64}`;

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    html, body {
      width: 1200px;
      height: 630px;
      overflow: hidden;
      background: #0d0d0d;
    }

    .bg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center top;
    }

    .scrim { display: none; }

    /* Glassmorphism CTA pill */
    .badge {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);

      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 18px 62px;
      background: rgba(255, 255, 255, 0.14);
      backdrop-filter: blur(24px) saturate(1.8);
      -webkit-backdrop-filter: blur(24px) saturate(1.8);
      border: 1.5px solid rgba(255, 255, 255, 0.55);
      border-radius: 100px;

      color: #ffffff;
      font-family: 'Segoe UI Variable Display', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 38px;
      font-weight: 400;
      letter-spacing: 0.04em;
      line-height: 1;
      white-space: nowrap;

      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.3),
        0 12px 48px rgba(0, 0, 0, 0.4);
    }
  </style>
</head>
<body>
  <img class="bg" src="${bgUrl}">
  <div class="scrim"></div>
  <div class="badge"><svg width="136" height="136" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="ag" x1="4" y1="50" x2="94" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FF3B3B"/><stop offset="20%" stop-color="#FF8C00"/><stop offset="40%" stop-color="#FFE033"/><stop offset="60%" stop-color="#4ADE80"/><stop offset="80%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#A78BFA"/></linearGradient></defs><path d="M4 50 L94 50 M65 16 L94 50 L65 84" stroke="url(#ag)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
</body>
</html>`;

console.log('Launching Chromium…');
const browser = await chromium.launch();
const page    = await browser.newPage();

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(html, { waitUntil: 'networkidle' });

// Give image a moment to fully render
await page.waitForTimeout(300);

const buffer = await page.screenshot({
  type: 'jpeg',
  quality: 92,
  fullPage: false,
  clip: { x: 0, y: 0, width: 1200, height: 630 },
});

await browser.close();

import { writeFileSync } from 'node:fs';
writeFileSync(outPublic, buffer);
console.log(`Saved ${(buffer.length / 1024).toFixed(0)} kB → public/og-image.jpg`);

if (existsSync(distDir)) {
  copyFileSync(outPublic, outDist);
  console.log(`Copied → dist/og-image.jpg`);
}
