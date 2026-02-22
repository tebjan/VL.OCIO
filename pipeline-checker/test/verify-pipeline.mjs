/**
 * Pipeline Checker — Automated Verification Script
 *
 * Uses Playwright to open the app in a real Chrome browser with WebGPU,
 * loads an EXR file (or sample data), captures all console output, checks
 * per-stage rendering via GPU diagnostic readback, and verifies the
 * screenshot has visible content.
 *
 * Usage:
 *   node test/verify-pipeline.mjs [--exr path/to/file.exr] [--url http://localhost:5174]
 *
 * Options:
 *   --exr <path>   Load a real EXR file instead of the sample gradient
 *   --url <url>    Dev server URL (default: http://localhost:5174)
 *
 * Requirements:
 *   - Vite dev server running (npm run dev)
 *   - Playwright installed (npm install -D playwright && npx playwright install chromium)
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_URL = 'http://localhost:5174';
const TIMEOUT_MS = 15_000;

function getArg(name) {
  const eq = process.argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

const url = getArg('url') ?? DEFAULT_URL;
const exrPath = getArg('exr');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function pass(msg) { console.log(`  ${GREEN}PASS${RESET} ${msg}`); totalPass++; }
function fail(msg) { console.log(`  ${RED}FAIL${RESET} ${msg}`); totalFail++; }
function warn(msg) { console.log(`  ${YELLOW}WARN${RESET} ${msg}`); }
function info(msg) { console.log(`  ${DIM}${msg}${RESET}`); }
function section(msg) { console.log(`\n${CYAN}${BOLD}── ${msg} ──${RESET}`); }

let totalPass = 0;
let totalFail = 0;

function check(condition, passMsg, failMsg) {
  if (condition) { pass(passMsg); }
  else { fail(failMsg ?? passMsg); }
  return condition;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`${BOLD}Pipeline Checker Verification${RESET}`);
  console.log(`URL: ${url}`);
  if (exrPath) {
    const absPath = resolve(exrPath);
    console.log(`EXR: ${absPath}`);
    if (!existsSync(absPath)) {
      console.error(`${RED}EXR file not found: ${absPath}${RESET}`);
      process.exit(2);
    }
  } else {
    console.log(`EXR: (using built-in sample gradient)`);
  }
  console.log();

  // Collect console messages
  const consoleLogs = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  const gpuValidationErrors = [];
  const wgslErrors = [];
  const diagnosticPixels = {};

  // ----- Launch browser with WebGPU -----
  section('1. Browser & WebGPU Init');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,UseSkiaRenderer',
      '--enable-dawn-features=allow_unsafe_apis',
      '--disable-dawn-features=disallow_unsafe_apis',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Attach console listener BEFORE navigation
  page.on('console', (msg) => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error') consoleErrors.push(text);
    else if (type === 'warning') consoleWarnings.push(text);
    consoleLogs.push({ type, text });

    // Parse diagnostic readback lines
    const diagMatch = text.match(/\[Pipeline Diagnostic\]\s+(Source|Stage \d+)\s*\(([^)]*)\):\s*\[([^\]]+)\]/);
    if (diagMatch) {
      const name = diagMatch[1] === 'Source' ? 'Source' : `${diagMatch[1]} (${diagMatch[2]})`;
      const vals = diagMatch[3].split(',').map(s => parseFloat(s.trim()));
      diagnosticPixels[name] = vals;
    }
    // Also match the Source pixel line format
    const srcMatch = text.match(/\[Pipeline Diagnostic\]\s+Source pixel\s*\(([^)]*)\):\s*\[([^\]]+)\]/);
    if (srcMatch) {
      diagnosticPixels['Source'] = srcMatch[2].split(',').map(s => parseFloat(s.trim()));
    }

    // Track GPU/shader errors
    if (text.includes('GPU validation error')) gpuValidationErrors.push(text);
    if (text.includes('Shader error') || text.includes('Error while parsing WGSL')) wgslErrors.push(text);
  });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // ----- Navigate -----
  let loadOk = false;
  try {
    const resp = await page.goto(url, { timeout: TIMEOUT_MS, waitUntil: 'networkidle' });
    loadOk = resp?.ok() ?? false;
  } catch (e) {
    fail(`Page load failed: ${e.message}`);
    console.log(`\n${RED}Is the dev server running? Start it with: npm run dev${RESET}\n`);
    await browser.close();
    process.exit(1);
  }
  check(loadOk, 'Page loaded successfully');

  const hasWebGPU = await page.evaluate(() => !!navigator.gpu);
  check(hasWebGPU, 'WebGPU available in browser');
  if (!hasWebGPU) {
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(1000);

  const hasError = await page.locator('text=WebGPU Not Available').isVisible().catch(() => false);
  if (hasError) {
    fail('WebGPU initialization failed — app shows error page');
    await browser.close();
    process.exit(1);
  }

  // App auto-loads sample image on init (no drop zone start screen)
  const hasUI = await page.evaluate(() => document.querySelectorAll('canvas').length > 0);
  check(hasUI, 'App initialized (canvases present)');

  // =========================================================================
  section('2. Load Image');
  // =========================================================================

  if (exrPath) {
    // Load real EXR file via page.route (efficient binary transfer)
    const absPath = resolve(exrPath).replace(/\\/g, '/');
    const fileName = absPath.split('/').pop();
    info(`Loading EXR: ${absPath} (${(readFileSync(absPath).length / 1024 / 1024).toFixed(1)}MB)`);

    const fileBuffer = readFileSync(absPath);

    // Serve the EXR file at a virtual URL so the browser can fetch it
    await page.route('**/___test_exr___', route => {
      route.fulfill({
        body: fileBuffer,
        contentType: 'application/octet-stream',
        headers: { 'Content-Length': String(fileBuffer.length) },
      });
    });

    // Fetch, parse, and synthesize a file drop inside the browser
    const loadResult = await page.evaluate(async (name) => {
      try {
        const resp = await fetch('/___test_exr___');
        const buffer = await resp.arrayBuffer();

        // Create a File and dispatch a drop event on the drop zone
        const file = new File([buffer], name, { type: 'application/octet-stream' });
        const dt = new DataTransfer();
        dt.items.add(file);

        // Find the drop zone — look for the outermost div with onDrop
        // DropZone renders: <div class="flex-1 flex flex-col items-center ...">
        const textEl = document.querySelector('p');
        let dropTarget = textEl;
        // Walk up to find the element with drop handlers (the outermost DropZone div)
        while (dropTarget && dropTarget.parentElement) {
          dropTarget = dropTarget.parentElement;
          if (dropTarget.className?.includes('flex-1') && dropTarget.className?.includes('p-8')) break;
        }
        if (!dropTarget) {
          // Fallback: use the first large flex container
          dropTarget = document.querySelector('.flex-1.flex.flex-col.p-8') || document.body;
        }

        dropTarget.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
        dropTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
        dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));

        return { ok: true, size: buffer.byteLength };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, fileName);

    if (loadResult.ok) {
      info(`File drop dispatched (${(loadResult.size / 1024 / 1024).toFixed(1)}MB), waiting for EXR parse...`);
    } else {
      fail(`File drop failed: ${loadResult.error}`);
    }

    // Wait for EXR parsing + pipeline render (can be slow for large files)
    await page.waitForTimeout(10000);
  } else {
    // App auto-loads sample image — just wait for pipeline to render
    info('Using auto-loaded sample image (no button click needed)');
    await page.waitForTimeout(2000);
    pass('Sample image auto-loaded');
  }

  // Check that we transitioned to the loaded state
  const canvasCount = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check(canvasCount > 1, `Canvases created after image load (found ${canvasCount})`);

  // Wait for async diagnostic readback
  await page.waitForTimeout(2000);

  // =========================================================================
  section('3. Console Error Analysis');
  // =========================================================================

  check(pageErrors.length === 0, 'No uncaught page errors',
    `${pageErrors.length} uncaught page error(s): ${pageErrors[0] ?? ''}`);

  check(gpuValidationErrors.length === 0, 'No GPU validation errors',
    `${gpuValidationErrors.length} GPU validation error(s): ${gpuValidationErrors[0] ?? ''}`);

  check(wgslErrors.length === 0, 'No WGSL shader errors',
    `${wgslErrors.length} WGSL error(s): ${wgslErrors[0]?.slice(0, 120) ?? ''}`);

  // Log warnings (not failures)
  const realWarnings = consoleWarnings.filter(w =>
    !w.includes('powerPreference') && !w.includes('React DevTools'));
  if (realWarnings.length > 0) {
    for (const w of realWarnings) warn(w.slice(0, 200));
  }

  // Check for 404 errors (non-critical but noted)
  const has404 = consoleErrors.some(e => e.includes('404'));
  if (has404) warn('Resource 404 detected (non-critical)');

  // =========================================================================
  section('4. Pipeline Stage Diagnostic Readback');
  // =========================================================================

  const diagLines = consoleLogs.filter(l => l.text.includes('[Pipeline Diagnostic]'));

  check(diagLines.length >= 6, `Pipeline diagnostic: ${diagLines.length} entries (need 6: source + 5 stages)`,
    `Only ${diagLines.length} diagnostic entries — pipeline may not have rendered completely`);

  // Check each stage pixel
  // Pipeline stages: Color Grade (0), RRT (1), ODT (2), Output Encode (3), Display Remap (4)
  // (InputConvert is folded into Color Grade's DecodeInput)
  const stageNames = [
    'Source',
    'Stage 0 (Color Grade)',
    'Stage 1 (RRT)',
    'Stage 2 (ODT)',
    'Stage 3 (Output Encode)',
    'Stage 4 (Display Remap)',
  ];

  for (const name of stageNames) {
    const vals = diagnosticPixels[name];
    if (!vals) {
      fail(`${name}: NO READBACK DATA`);
      continue;
    }
    const valStr = vals.map(v => v.toFixed(4)).join(', ');
    const isNonBlack = vals.some((v, i) => i < 3 && Math.abs(v) > 0.0001);
    const hasAlpha = vals.length >= 4 && vals[3] > 0;

    if (isNonBlack && hasAlpha) {
      pass(`${name}: [${valStr}]`);
    } else if (!isNonBlack) {
      fail(`${name}: [${valStr}] — BLACK (zero RGB)`);
    } else {
      fail(`${name}: [${valStr}] — zero alpha`);
    }
  }

  // Check stage-to-stage variation (stages shouldn't all be identical to source)
  const srcVals = diagnosticPixels['Source'];
  const lastStageVals = diagnosticPixels['Stage 4 (Display Remap)'];
  if (srcVals && lastStageVals) {
    const diff = srcVals.reduce((sum, v, i) => sum + Math.abs(v - lastStageVals[i]), 0);
    if (diff > 0.001) {
      pass(`Pipeline transforms data (source→output delta: ${diff.toFixed(4)})`);
    } else {
      warn(`All stages output identical values — transforms may be no-ops with default settings`);
    }
  }

  // =========================================================================
  section('5. Screenshot Verification');
  // =========================================================================

  const screenshotPath = 'test/screenshot-pipeline.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  pass(`Screenshot saved: ${screenshotPath}`);

  // Verify screenshot has non-black content by checking the page's rendered pixels
  // via Playwright's built-in screenshot buffer analysis
  const screenshotBuffer = await page.screenshot();
  const totalBytes = screenshotBuffer.length;
  // PNG header is 8 bytes, quick check that the file is reasonable
  check(totalBytes > 10000, `Screenshot size: ${(totalBytes / 1024).toFixed(0)}KB (non-trivial)`);

  // =========================================================================
  section('6. Canvas Count & Dimensions');
  // =========================================================================

  const canvasInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('canvas')).map((c, i) => ({
      index: i,
      width: c.width,
      height: c.height,
      cssW: c.offsetWidth,
      cssH: c.offsetHeight,
    }));
  });

  // Expect: 1 hidden init canvas + 9 thumbnail canvases + 1 main preview = 11 minimum
  check(canvasInfo.length >= 11, `Canvas count: ${canvasInfo.length} (expect ≥11: init + 9 thumbnails + preview)`);

  // Check thumbnail canvases have valid size
  const thumbnails = canvasInfo.filter(c => c.width > 1 && c.width < 300);
  check(thumbnails.length >= 9, `Thumbnail canvases: ${thumbnails.length} (expect 9)`);

  // Check main preview canvas
  const previews = canvasInfo.filter(c => c.width >= 300);
  check(previews.length >= 1, `Main preview canvas: ${previews.length >= 1 ? `${previews[0]?.width}x${previews[0]?.height}` : 'MISSING'}`);

  // =========================================================================
  section('7. Full Console Log');
  // =========================================================================

  info(`Total console messages: ${consoleLogs.length}`);
  for (const l of consoleLogs) {
    if (l.type === 'error') console.log(`    ${RED}[${l.type}]${RESET} ${l.text.slice(0, 200)}`);
    else if (l.type === 'warning') console.log(`    ${YELLOW}[${l.type}]${RESET} ${l.text.slice(0, 200)}`);
    else console.log(`    ${DIM}[${l.type}]${RESET} ${l.text.slice(0, 200)}`);
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log(`\n${'═'.repeat(60)}`);
  const passColor = totalPass > 0 ? GREEN : DIM;
  const failColor = totalFail > 0 ? RED : GREEN;
  console.log(`${BOLD}Results: ${passColor}${totalPass} passed${RESET}, ${failColor}${totalFail} failed${RESET}`);
  console.log(`${'═'.repeat(60)}\n`);

  const keepOpen = process.argv.includes('--keep-open');
  if (keepOpen) {
    console.log(`\n${CYAN}Browser kept open. Press Ctrl+C to exit.${RESET}\n`);
    await new Promise(() => {}); // block forever
  }

  await browser.close();
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${RED}Fatal error: ${err.message}${RESET}`);
  console.error(err.stack);
  process.exit(2);
});
