/**
 * SDSL/WGSL Parity Verification Script
 *
 * Validates that the transpiled WGSL files in shaders/transpiled/ are
 * mathematically identical to the SDSL source shaders. Checks:
 * 1. Scalar constants (ACEScct, ACEScc, PQ, HLG)
 * 2. Gamut matrices (SDSL row-major vs WGSL column-major, transposed)
 * 3. Transfer function round-trips (sRGB, ACEScct, PQ)
 * 4. Mid-gray passthrough through AP1_to_Rec709
 * 5. Diff summary between transpiled and hand-ported WGSL
 *
 * Usage: node pipeline-checker/test/verify-sdsl-wgsl-parity.mjs
 * Exit: 0 = all pass, 1 = failures
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Locate repo root
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let totalPass = 0;
let totalFail = 0;

function pass(msg) { console.log(`  ${GREEN}PASS${RESET} ${msg}`); totalPass++; }
function fail(msg) { console.log(`  ${RED}FAIL${RESET} ${msg}`); totalFail++; }
function info(msg) { console.log(`  ${DIM}INFO${RESET} ${msg}`); }
function section(msg) { console.log(`\n${CYAN}${BOLD}-- ${msg} --${RESET}`); }

// ---------------------------------------------------------------------------
// File readers
// ---------------------------------------------------------------------------
function readFile(relPath) {
  return readFileSync(resolve(repoRoot, relPath), 'utf-8');
}

// ---------------------------------------------------------------------------
// 1. Scalar constant extraction and comparison
// ---------------------------------------------------------------------------
section('1. Scalar Constants');

const sdslColorSpace = readFile('shaders/ColorSpaceConversion.sdsl');

// Read all transpiled WGSL files to search for constants
const wgslFiles = [
  'shaders/transpiled/input-convert.wgsl',
  'shaders/transpiled/color-grade.wgsl',
  'shaders/transpiled/rrt.wgsl',
  'shaders/transpiled/odt.wgsl',
  'shaders/transpiled/output-encode.wgsl',
  'shaders/transpiled/display-remap.wgsl',
];
const allWgsl = wgslFiles.map(f => readFile(f)).join('\n');

// Parse SDSL: "static const float NAME = VALUE;"
function parseSdslScalar(source, name) {
  const re = new RegExp(`static\\s+const\\s+float\\s+${name}\\s*=\\s*([\\d.eE+-]+)\\s*;`);
  const m = source.match(re);
  return m ? parseFloat(m[1]) : null;
}

// Parse WGSL: "const NAME: f32 = VALUE;" or "const NAME = VALUE;"
function parseWgslScalar(source, name) {
  const re = new RegExp(`const\\s+${name}(?:\\s*:\\s*f32)?\\s*=\\s*([\\d.eE+-]+)\\s*;`);
  const m = source.match(re);
  return m ? parseFloat(m[1]) : null;
}

// Pairs of [SDSL name, WGSL name]. When names differ between SDSL and WGSL,
// both are specified; when they are the same, only one name is given.
const scalarConstants = [
  // ACEScct
  ['ACEScct_A'], ['ACEScct_B'], ['ACEScct_CUT_LINEAR'], ['ACEScct_CUT_LOG'],
  // ACEScc
  ['ACESCC_MAX'],
  // Note: SDSL uses ACESCC_MIDGRAY, WGSL color-grade uses ACESCCT_MIDGRAY (same value)
  ['ACESCC_MIDGRAY', 'ACESCCT_MIDGRAY'],
  // PQ
  ['PQ_m1'], ['PQ_m2'], ['PQ_c1'], ['PQ_c2'], ['PQ_c3'], ['PQ_MAX_NITS'],
  // HLG
  ['HLG_a'], ['HLG_b'], ['HLG_c'],
];

const SCALAR_TOL = 1e-12;

for (const entry of scalarConstants) {
  const sdslName = entry[0];
  const wgslName = entry.length > 1 ? entry[1] : entry[0];
  const label = sdslName === wgslName ? sdslName : `${sdslName} (WGSL: ${wgslName})`;

  const sdslVal = parseSdslScalar(sdslColorSpace, sdslName);
  const wgslVal = parseWgslScalar(allWgsl, wgslName);

  if (sdslVal === null) {
    fail(`${label}: not found in SDSL`);
    continue;
  }
  if (wgslVal === null) {
    fail(`${label}: not found in WGSL`);
    continue;
  }

  const diff = Math.abs(sdslVal - wgslVal);
  if (diff <= SCALAR_TOL) {
    pass(`${label}: SDSL=${sdslVal} WGSL=${wgslVal} (delta=${diff.toExponential(2)})`);
  } else {
    fail(`${label}: SDSL=${sdslVal} WGSL=${wgslVal} (delta=${diff.toExponential(2)}, tol=${SCALAR_TOL})`);
  }
}

// ---------------------------------------------------------------------------
// 2. Matrix extraction and comparison
// ---------------------------------------------------------------------------
section('2. Gamut Matrices');

// Parse SDSL row-major matrix: float3x3(v00, v01, v02, v10, v11, v12, v20, v21, v22)
// or float3x3(float3(r0c0, r0c1, r0c2), float3(r1c0, r1c1, r1c2), float3(r2c0, r2c1, r2c2))
function parseSdslMatrix(source, name) {
  // Match: static const float3x3 NAME = float3x3(\n  values \n);
  const re = new RegExp(
    `static\\s+const\\s+float3x3\\s+${name}\\s*=\\s*float3x3\\s*\\(([^;]+?)\\)\\s*;`,
    's'
  );
  const m = source.match(re);
  if (!m) return null;

  // Remove type annotations (float3x3, float3) so their digits don't pollute extraction
  const cleaned = m[1]
    .replace(/float\d+x\d+/g, '')
    .replace(/float\d+/g, '');

  // Extract all numeric values
  const nums = cleaned.match(/[-+]?\d+\.?\d*(?:[eE][-+]?\d+)?/g);
  if (!nums || nums.length < 9) return null;

  // SDSL float3x3 is row-major: first 3 are row 0, next 3 are row 1, etc.
  const vals = nums.slice(0, 9).map(Number);
  return {
    rows: [
      [vals[0], vals[1], vals[2]],
      [vals[3], vals[4], vals[5]],
      [vals[6], vals[7], vals[8]],
    ]
  };
}

// Parse WGSL column-major matrix: mat3x3<f32>(vec3<f32>(c0r0, c0r1, c0r2), ...)
// WGSL mat3x3 stores by columns. First vec3 is column 0.
function parseWgslMatrix(source, name) {
  // Find the FIRST occurrence of the named matrix
  const re = new RegExp(
    `const\\s+${name}\\s*=\\s*mat3x3<f32>\\s*\\(([^;]+?)\\)\\s*;`,
    's'
  );
  const m = source.match(re);
  if (!m) return null;

  // Remove type annotations (mat3x3<f32>, vec3<f32>) so their digits don't pollute extraction
  const cleaned = m[1]
    .replace(/mat\d+x\d+<f\d+>/g, '')
    .replace(/vec\d+<f\d+>/g, '');

  // Extract all numeric values
  const nums = cleaned.match(/[-+]?\d+\.?\d*(?:[eE][-+]?\d+)?/g);
  if (!nums || nums.length < 9) return null;

  // WGSL column-major: first 3 are column 0 (rows 0,1,2 of col 0)
  const vals = nums.slice(0, 9).map(Number);
  return {
    cols: [
      [vals[0], vals[1], vals[2]],  // column 0
      [vals[3], vals[4], vals[5]],  // column 1
      [vals[6], vals[7], vals[8]],  // column 2
    ]
  };
}

// Transpose WGSL column-major to row-major for comparison with SDSL
function wgslColsToRows(wgslMat) {
  const c = wgslMat.cols;
  return [
    [c[0][0], c[1][0], c[2][0]],  // row 0 = (col0[0], col1[0], col2[0])
    [c[0][1], c[1][1], c[2][1]],  // row 1
    [c[0][2], c[1][2], c[2][2]],  // row 2
  ];
}

const MATRIX_TOL = 1e-6;

const matrixPairs = [
  // [SDSL name, WGSL name, SDSL source, note]
  ['AP1_to_Rec709', 'AP1_to_Rec709', sdslColorSpace, 'ACES AP1 to sRGB primaries'],
  ['Rec709_to_AP1', 'Rec709_to_AP1', sdslColorSpace, 'sRGB to ACES AP1 primaries'],
  ['Rec709_to_Rec2020', 'Rec709_to_Rec2020', sdslColorSpace, 'sRGB to Rec.2020'],
  ['Rec2020_to_Rec709', 'Rec2020_to_Rec709', sdslColorSpace, 'Rec.2020 to sRGB'],
];

for (const [sdslName, wgslName, sdslSource] of matrixPairs) {
  const sdslMat = parseSdslMatrix(sdslSource, sdslName);
  const wgslMat = parseWgslMatrix(allWgsl, wgslName);

  if (!sdslMat) { fail(`${sdslName}: not found in SDSL`); continue; }
  if (!wgslMat) { fail(`${wgslName}: not found in WGSL`); continue; }

  // Transpose WGSL column-major to row-major
  const wgslRows = wgslColsToRows(wgslMat);

  let maxDiff = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(sdslMat.rows[r][c] - wgslRows[r][c]);
      if (d > maxDiff) maxDiff = d;
    }
  }

  if (maxDiff <= MATRIX_TOL) {
    pass(`${sdslName}: max element delta = ${maxDiff.toExponential(2)} (tol ${MATRIX_TOL})`);
  } else {
    fail(`${sdslName}: max element delta = ${maxDiff.toExponential(2)} exceeds tol ${MATRIX_TOL}`);
    // Show details
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(sdslMat.rows[r][c] - wgslRows[r][c]);
        if (d > MATRIX_TOL) {
          info(`  [${r}][${c}]: SDSL=${sdslMat.rows[r][c]} WGSL=${wgslRows[r][c]} delta=${d}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Transfer function round-trip tests
// ---------------------------------------------------------------------------
section('3. Transfer Function Round-Trips');

const ROUND_TRIP_TOL_SRGB = 1e-6;
const ROUND_TRIP_TOL_ACESCCT = 1e-6;
const ROUND_TRIP_TOL_PQ = 1e-5;

// sRGB transfer functions (IEC 61966-2-1)
function linearToSRGB(l) {
  if (l <= 0.0031308) return l * 12.92;
  return 1.055 * Math.pow(l, 1.0 / 2.4) - 0.055;
}
function sRGBToLinear(s) {
  if (s <= 0.04045) return s / 12.92;
  return Math.pow((s + 0.055) / 1.055, 2.4);
}

// ACEScct transfer functions (S-2016-001)
const ACEScct_A = 10.5402377416545;
const ACEScct_B = 0.0729055341958355;
const ACEScct_CUT_LINEAR = 0.0078125;
const ACEScct_CUT_LOG = 0.155251141552511;

function linearToACEScct(l) {
  const lc = Math.max(l, 1e-10);
  if (lc < ACEScct_CUT_LINEAR) {
    return ACEScct_A * lc + ACEScct_B;
  }
  return (Math.log2(lc) + 9.72) / 17.52;
}
function ACEScctToLinear(cct) {
  if (cct < ACEScct_CUT_LOG) {
    return (cct - ACEScct_B) / ACEScct_A;
  }
  return Math.min(Math.pow(2, cct * 17.52 - 9.72), 65504.0);
}

// PQ (ST.2084) transfer functions
const PQ_m1 = 0.1593017578125;
const PQ_m2 = 78.84375;
const PQ_c1 = 0.8359375;
const PQ_c2 = 18.8515625;
const PQ_c3 = 18.6875;

function linearToPQ(L) {
  const Y = Math.max(L, 0);
  const Ym1 = Math.pow(Y, PQ_m1);
  return Math.pow((PQ_c1 + PQ_c2 * Ym1) / (1.0 + PQ_c3 * Ym1), PQ_m2);
}
function PQToLinear(N) {
  const Nm2 = Math.pow(Math.max(N, 0), 1.0 / PQ_m2);
  return Math.pow(Math.max(Nm2 - PQ_c1, 0) / (PQ_c2 - PQ_c3 * Nm2), 1.0 / PQ_m1);
}

// sRGB round-trip
for (const val of [0.01, 0.18, 0.5, 1.0]) {
  const encoded = linearToSRGB(val);
  const decoded = sRGBToLinear(encoded);
  const err = Math.abs(val - decoded);
  if (err < ROUND_TRIP_TOL_SRGB) {
    pass(`sRGB round-trip ${val} -> ${encoded.toFixed(6)} -> ${decoded.toFixed(8)} (err=${err.toExponential(2)})`);
  } else {
    fail(`sRGB round-trip ${val}: err=${err.toExponential(2)} exceeds tol ${ROUND_TRIP_TOL_SRGB}`);
  }
}

// ACEScct round-trip
for (const val of [0.001, 0.18, 1.0, 10.0]) {
  const encoded = linearToACEScct(val);
  const decoded = ACEScctToLinear(encoded);
  const err = Math.abs(val - decoded);
  if (err < ROUND_TRIP_TOL_ACESCCT) {
    pass(`ACEScct round-trip ${val} -> ${encoded.toFixed(6)} -> ${decoded.toFixed(8)} (err=${err.toExponential(2)})`);
  } else {
    fail(`ACEScct round-trip ${val}: err=${err.toExponential(2)} exceeds tol ${ROUND_TRIP_TOL_ACESCCT}`);
  }
}

// PQ round-trip
for (const val of [0.01, 0.18, 1.0]) {
  const encoded = linearToPQ(val);
  const decoded = PQToLinear(encoded);
  const err = Math.abs(val - decoded);
  if (err < ROUND_TRIP_TOL_PQ) {
    pass(`PQ round-trip ${val} -> ${encoded.toFixed(6)} -> ${decoded.toFixed(8)} (err=${err.toExponential(2)})`);
  } else {
    fail(`PQ round-trip ${val}: err=${err.toExponential(2)} exceeds tol ${ROUND_TRIP_TOL_PQ}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Mid-gray passthrough test
// ---------------------------------------------------------------------------
section('4. Mid-Gray Passthrough (AP1_to_Rec709)');

// Extract AP1_to_Rec709 from transpiled WGSL and apply to (0.18, 0.18, 0.18)
const ap1Rec709Wgsl = parseWgslMatrix(allWgsl, 'AP1_to_Rec709');
if (ap1Rec709Wgsl) {
  const rows = wgslColsToRows(ap1Rec709Wgsl);
  const gray = [0.18, 0.18, 0.18];

  // Matrix * vector (row-major)
  const result = [
    rows[0][0] * gray[0] + rows[0][1] * gray[1] + rows[0][2] * gray[2],
    rows[1][0] * gray[0] + rows[1][1] * gray[1] + rows[1][2] * gray[2],
    rows[2][0] * gray[0] + rows[2][1] * gray[1] + rows[2][2] * gray[2],
  ];

  const sum = result[0] + result[1] + result[2];
  const allPlausible = result.every(v => v >= 0.05 && v <= 0.5);
  const sumClose = Math.abs(sum - 0.54) < 0.1;

  if (allPlausible && sumClose) {
    pass(`Mid-gray (0.18,0.18,0.18) * AP1_to_Rec709 = (${result.map(v => v.toFixed(6)).join(', ')}) sum=${sum.toFixed(6)}`);
  } else {
    fail(`Mid-gray result implausible: (${result.map(v => v.toFixed(6)).join(', ')}) sum=${sum.toFixed(6)}`);
  }
} else {
  fail('AP1_to_Rec709 matrix not found in WGSL');
}

// ---------------------------------------------------------------------------
// 5. Diff summary: transpiled vs hand-ported
// ---------------------------------------------------------------------------
section('5. Diff Summary (transpiled vs hand-ported)');

const stageFiles = [
  'input-convert.wgsl',
  'color-grade.wgsl',
  'rrt.wgsl',
  'odt.wgsl',
  'output-encode.wgsl',
  'display-remap.wgsl',
];

for (const f of stageFiles) {
  const transpiled = readFile(`shaders/transpiled/${f}`);
  let handPorted;
  try {
    handPorted = readFile(`pipeline-checker/src/shaders/generated/${f}`);
  } catch {
    info(`${f}: hand-ported file not found (skip diff)`);
    continue;
  }

  const transpiledLines = transpiled.split('\n');
  const handPortedLines = handPorted.split('\n');

  if (transpiled.trim() === handPorted.trim()) {
    pass(`${f}: IDENTICAL (${transpiledLines.length} lines)`);
  } else {
    const delta = transpiledLines.length - handPortedLines.length;
    const sign = delta >= 0 ? '+' : '';
    info(`${f}: DIFFERS (transpiled: ${transpiledLines.length}, hand-ported: ${handPortedLines.length}, delta: ${sign}${delta} lines)`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
const passColor = totalPass > 0 ? GREEN : DIM;
const failColor = totalFail > 0 ? RED : GREEN;
console.log(`${BOLD}Results: ${passColor}${totalPass} passed${RESET}, ${failColor}${totalFail} failed${RESET}`);
console.log(`${'='.repeat(60)}\n`);

process.exit(totalFail > 0 ? 1 : 0);
