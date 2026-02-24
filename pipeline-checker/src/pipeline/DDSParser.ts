/**
 * DDS file parser — extracts texture data from DirectDraw Surface files.
 *
 * Supports:
 * - BC-compressed: BC1–BC7 (legacy FourCC codes + DX10 extended header)
 * - Uncompressed float: RGBA32F, RGB32F, RGBA16F, RG32F, RG16F, R32F, R16F, R11G11B10F
 * - Uncompressed UNORM: RGBA16, RG16, R16, RGBA8, BGRA8, BGRX8, R8, A8, R10G10B10A2
 * - Uncompressed SNORM: RGBA16, RGBA8, RG16, RG8, R16, R8
 * - Legacy (no DX10 header): DDPF_RGB and DDPF_LUMINANCE pixel formats
 */

export interface DDSCompressed {
  kind: 'compressed';
  width: number;
  height: number;
  format: GPUTextureFormat;
  blockData: Uint8Array;
  /** Bytes per 4×4 block (8 for BC1/BC4, 16 for all others) */
  blockSize: number;
  /** Blocks per row (ceil(width / 4)) */
  blocksPerRow: number;
  /** Blocks per column (ceil(height / 4)) */
  blocksPerCol: number;
  /** Human-readable format name for display */
  formatLabel: string;
}

export interface DDSUncompressed {
  kind: 'uncompressed';
  width: number;
  height: number;
  /** RGBA float32 pixels, top-to-bottom (no flip needed — DDS is already top-down) */
  float32Data: Float32Array;
  /** Human-readable format name for display */
  formatLabel: string;
}

export type DDSParseResult = DDSCompressed | DDSUncompressed;

// ── Constants ──────────────────────────────────────────────────────────────

const DDS_MAGIC = 0x20534444; // "DDS "

// DDS_PIXELFORMAT flags
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_ALPHA       = 0x2;
const DDPF_FOURCC      = 0x4;
const DDPF_RGB         = 0x40;
const DDPF_LUMINANCE   = 0x20000;

// Legacy FourCC codes
const FOURCC_DXT1 = 0x31545844; // "DXT1"
const FOURCC_DXT3 = 0x33545844; // "DXT3"
const FOURCC_DXT5 = 0x35545844; // "DXT5"
const FOURCC_ATI1 = 0x31495441; // "ATI1"
const FOURCC_ATI2 = 0x32495441; // "ATI2"
const FOURCC_BC4U = 0x55344342; // "BC4U"
const FOURCC_BC5U = 0x55354342; // "BC5U"
const FOURCC_DX10 = 0x30315844; // "DX10"

// DXGI format values — uncompressed
const DXGI_FORMAT_R32G32B32A32_FLOAT  =  2;
const DXGI_FORMAT_R32G32B32_FLOAT     =  6;
const DXGI_FORMAT_R16G16B16A16_FLOAT  = 10;
const DXGI_FORMAT_R16G16B16A16_UNORM  = 11;
const DXGI_FORMAT_R16G16B16A16_SNORM  = 13;
const DXGI_FORMAT_R32G32_FLOAT        = 16;
const DXGI_FORMAT_R10G10B10A2_UNORM   = 24;
const DXGI_FORMAT_R11G11B10_FLOAT     = 26;
const DXGI_FORMAT_R8G8B8A8_UNORM      = 28;
const DXGI_FORMAT_R8G8B8A8_UNORM_SRGB = 29;
const DXGI_FORMAT_R8G8B8A8_SNORM      = 31;
const DXGI_FORMAT_R16G16_FLOAT        = 34;
const DXGI_FORMAT_R16G16_UNORM        = 35;
const DXGI_FORMAT_R16G16_SNORM        = 37;
const DXGI_FORMAT_R32_FLOAT           = 41;
const DXGI_FORMAT_R8G8_UNORM          = 49;
const DXGI_FORMAT_R8G8_SNORM          = 51;
const DXGI_FORMAT_R16_FLOAT           = 54;
const DXGI_FORMAT_R16_UNORM           = 56;
const DXGI_FORMAT_R16_SNORM           = 58;
const DXGI_FORMAT_R8_UNORM            = 61;
const DXGI_FORMAT_R8_SNORM            = 63;
const DXGI_FORMAT_A8_UNORM            = 65;
const DXGI_FORMAT_B8G8R8A8_UNORM      = 87;
const DXGI_FORMAT_B8G8R8X8_UNORM      = 88;
const DXGI_FORMAT_B8G8R8A8_UNORM_SRGB = 91;
const DXGI_FORMAT_B8G8R8X8_UNORM_SRGB = 93;

// DXGI format values — BC-compressed
const DXGI_FORMAT_BC1_UNORM      = 71;
const DXGI_FORMAT_BC1_UNORM_SRGB = 72;
const DXGI_FORMAT_BC2_UNORM      = 74;
const DXGI_FORMAT_BC2_UNORM_SRGB = 75;
const DXGI_FORMAT_BC3_UNORM      = 77;
const DXGI_FORMAT_BC3_UNORM_SRGB = 78;
const DXGI_FORMAT_BC4_UNORM      = 80;
const DXGI_FORMAT_BC4_SNORM      = 81;
const DXGI_FORMAT_BC5_UNORM      = 83;
const DXGI_FORMAT_BC5_SNORM      = 84;
const DXGI_FORMAT_BC6H_UF16      = 95;
const DXGI_FORMAT_BC6H_SF16      = 96;
const DXGI_FORMAT_BC7_UNORM      = 98;
const DXGI_FORMAT_BC7_UNORM_SRGB = 99;

// ── Format tables ──────────────────────────────────────────────────────────

interface BCFormatInfo {
  gpuFormat: GPUTextureFormat;
  blockSize: number;
  label: string;
}

const DXGI_TO_BC: Record<number, BCFormatInfo> = {
  [DXGI_FORMAT_BC1_UNORM]:      { gpuFormat: 'bc1-rgba-unorm',      blockSize: 8,  label: 'BC1 (DXT1)' },
  [DXGI_FORMAT_BC1_UNORM_SRGB]: { gpuFormat: 'bc1-rgba-unorm-srgb', blockSize: 8,  label: 'BC1 sRGB' },
  [DXGI_FORMAT_BC2_UNORM]:      { gpuFormat: 'bc2-rgba-unorm',      blockSize: 16, label: 'BC2 (DXT3)' },
  [DXGI_FORMAT_BC2_UNORM_SRGB]: { gpuFormat: 'bc2-rgba-unorm-srgb', blockSize: 16, label: 'BC2 sRGB' },
  [DXGI_FORMAT_BC3_UNORM]:      { gpuFormat: 'bc3-rgba-unorm',      blockSize: 16, label: 'BC3 (DXT5)' },
  [DXGI_FORMAT_BC3_UNORM_SRGB]: { gpuFormat: 'bc3-rgba-unorm-srgb', blockSize: 16, label: 'BC3 sRGB' },
  [DXGI_FORMAT_BC4_UNORM]:      { gpuFormat: 'bc4-r-unorm',         blockSize: 8,  label: 'BC4' },
  [DXGI_FORMAT_BC4_SNORM]:      { gpuFormat: 'bc4-r-snorm',         blockSize: 8,  label: 'BC4 signed' },
  [DXGI_FORMAT_BC5_UNORM]:      { gpuFormat: 'bc5-rg-unorm',        blockSize: 16, label: 'BC5' },
  [DXGI_FORMAT_BC5_SNORM]:      { gpuFormat: 'bc5-rg-snorm',        blockSize: 16, label: 'BC5 signed' },
  [DXGI_FORMAT_BC6H_UF16]:      { gpuFormat: 'bc6h-rgb-ufloat',     blockSize: 16, label: 'BC6H (HDR)' },
  [DXGI_FORMAT_BC6H_SF16]:      { gpuFormat: 'bc6h-rgb-float',      blockSize: 16, label: 'BC6H signed' },
  [DXGI_FORMAT_BC7_UNORM]:      { gpuFormat: 'bc7-rgba-unorm',      blockSize: 16, label: 'BC7' },
  [DXGI_FORMAT_BC7_UNORM_SRGB]: { gpuFormat: 'bc7-rgba-unorm-srgb', blockSize: 16, label: 'BC7 sRGB' },
};

const FOURCC_TO_BC: Record<number, BCFormatInfo> = {
  [FOURCC_DXT1]: { gpuFormat: 'bc1-rgba-unorm', blockSize: 8,  label: 'BC1 (DXT1)' },
  [FOURCC_DXT3]: { gpuFormat: 'bc2-rgba-unorm', blockSize: 16, label: 'BC2 (DXT3)' },
  [FOURCC_DXT5]: { gpuFormat: 'bc3-rgba-unorm', blockSize: 16, label: 'BC3 (DXT5)' },
  [FOURCC_ATI1]: { gpuFormat: 'bc4-r-unorm',    blockSize: 8,  label: 'BC4 (ATI1)' },
  [FOURCC_ATI2]: { gpuFormat: 'bc5-rg-unorm',   blockSize: 16, label: 'BC5 (ATI2)' },
  [FOURCC_BC4U]: { gpuFormat: 'bc4-r-unorm',    blockSize: 8,  label: 'BC4' },
  [FOURCC_BC5U]: { gpuFormat: 'bc5-rg-unorm',   blockSize: 16, label: 'BC5' },
};

// ── Float helpers ──────────────────────────────────────────────────────────

/** 11-bit unsigned float (R11G11B10F red/green channel) → float32. */
function uf11ToF32(val: number): number {
  const exp  = (val >> 6) & 0x1F;
  const mant = val & 0x3F;
  if (exp === 0)  return mant / (64 * 16384);  // subnormal
  if (exp === 31) return mant ? NaN : Infinity;
  return (1 + mant / 64) * (2 ** (exp - 15));
}

/** 10-bit unsigned float (R11G11B10F blue channel) → float32. */
function uf10ToF32(val: number): number {
  const exp  = (val >> 5) & 0x1F;
  const mant = val & 0x1F;
  if (exp === 0)  return mant / (32 * 16384);  // subnormal
  if (exp === 31) return mant ? NaN : Infinity;
  return (1 + mant / 32) * (2 ** (exp - 15));
}

/** Signed 8-bit normalized integer → float in [-1, 1]. */
function snorm8(val: number): number {
  const s = val > 127 ? val - 256 : val;
  return Math.max(-1, s / 127);
}

/** Signed 16-bit normalized integer → float in [-1, 1]. */
function snorm16(val: number): number {
  const s = val > 32767 ? val - 65536 : val;
  return Math.max(-1, s / 32767);
}

// ── Uncompressed DXGI decoder ──────────────────────────────────────────────

/**
 * Decode a block of uncompressed DDS pixels (any supported DXGI format) to
 * a contiguous RGBA Float32Array. Returns null for unknown formats.
 */
function decodeDXGIUncompressed(
  dxgiFormat: number,
  pixelData: Uint8Array,
  numPixels: number,
): { out: Float32Array; bpp: number; label: string } | null {
  const dv = new DataView(pixelData.buffer, pixelData.byteOffset, pixelData.byteLength);
  const out = new Float32Array(numPixels * 4);
  let bpp: number;
  let label: string;
  type Fn = (i: number, o: number) => void;
  let decode: Fn;

  switch (dxgiFormat) {
    // ── Float formats ──────────────────────────────────────────────────────
    case DXGI_FORMAT_R32G32B32A32_FLOAT:
      bpp = 16; label = 'RGBA32F';
      decode = (i, o) => {
        out[o]   = dv.getFloat32(i,      true);
        out[o+1] = dv.getFloat32(i +  4, true);
        out[o+2] = dv.getFloat32(i +  8, true);
        out[o+3] = dv.getFloat32(i + 12, true);
      }; break;

    case DXGI_FORMAT_R32G32B32_FLOAT:
      bpp = 12; label = 'RGB32F';
      decode = (i, o) => {
        out[o]   = dv.getFloat32(i,     true);
        out[o+1] = dv.getFloat32(i + 4, true);
        out[o+2] = dv.getFloat32(i + 8, true);
        out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R16G16B16A16_FLOAT:
      bpp = 8; label = 'RGBA16F';
      decode = (i, o) => {
        out[o]   = dv.getFloat16(i,     true);
        out[o+1] = dv.getFloat16(i + 2, true);
        out[o+2] = dv.getFloat16(i + 4, true);
        out[o+3] = dv.getFloat16(i + 6, true);
      }; break;

    case DXGI_FORMAT_R32G32_FLOAT:
      bpp = 8; label = 'RG32F';
      decode = (i, o) => {
        out[o]   = dv.getFloat32(i,     true);
        out[o+1] = dv.getFloat32(i + 4, true);
        out[o+2] = 0; out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R11G11B10_FLOAT:
      bpp = 4; label = 'R11G11B10F';
      decode = (i, o) => {
        const p  = dv.getUint32(i, true);
        out[o]   = uf11ToF32( p         & 0x7FF);
        out[o+1] = uf11ToF32((p >> 11)  & 0x7FF);
        out[o+2] = uf10ToF32((p >> 22)  & 0x3FF);
        out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R16G16_FLOAT:
      bpp = 4; label = 'RG16F';
      decode = (i, o) => {
        out[o]   = dv.getFloat16(i,     true);
        out[o+1] = dv.getFloat16(i + 2, true);
        out[o+2] = 0; out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R32_FLOAT:
      bpp = 4; label = 'R32F';
      decode = (i, o) => {
        const v  = dv.getFloat32(i, true);
        out[o] = out[o+1] = out[o+2] = v; out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R16_FLOAT:
      bpp = 2; label = 'R16F';
      decode = (i, o) => {
        const v  = dv.getFloat16(i, true);
        out[o] = out[o+1] = out[o+2] = v; out[o+3] = 1;
      }; break;

    // ── UNORM formats ──────────────────────────────────────────────────────
    case DXGI_FORMAT_R16G16B16A16_UNORM:
      bpp = 8; label = 'RGBA16';
      decode = (i, o) => {
        out[o]   = dv.getUint16(i,     true) / 65535;
        out[o+1] = dv.getUint16(i + 2, true) / 65535;
        out[o+2] = dv.getUint16(i + 4, true) / 65535;
        out[o+3] = dv.getUint16(i + 6, true) / 65535;
      }; break;

    case DXGI_FORMAT_R10G10B10A2_UNORM:
      bpp = 4; label = 'RGB10A2';
      decode = (i, o) => {
        const p  = dv.getUint32(i, true);
        out[o]   = ( p         & 0x3FF) / 1023;
        out[o+1] = ((p >> 10)  & 0x3FF) / 1023;
        out[o+2] = ((p >> 20)  & 0x3FF) / 1023;
        out[o+3] = ((p >> 30)  & 0x003) / 3;
      }; break;

    case DXGI_FORMAT_R8G8B8A8_UNORM:
    case DXGI_FORMAT_R8G8B8A8_UNORM_SRGB:
      bpp = 4;
      label = dxgiFormat === DXGI_FORMAT_R8G8B8A8_UNORM_SRGB ? 'RGBA8 sRGB' : 'RGBA8';
      decode = (i, o) => {
        out[o]   = dv.getUint8(i)     / 255;
        out[o+1] = dv.getUint8(i + 1) / 255;
        out[o+2] = dv.getUint8(i + 2) / 255;
        out[o+3] = dv.getUint8(i + 3) / 255;
      }; break;

    case DXGI_FORMAT_R16G16_UNORM:
      bpp = 4; label = 'RG16';
      decode = (i, o) => {
        out[o]   = dv.getUint16(i,     true) / 65535;
        out[o+1] = dv.getUint16(i + 2, true) / 65535;
        out[o+2] = 0; out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R8G8_UNORM:
      bpp = 2; label = 'RG8';
      decode = (i, o) => {
        out[o]   = dv.getUint8(i)     / 255;
        out[o+1] = dv.getUint8(i + 1) / 255;
        out[o+2] = 0; out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R16_UNORM:
      bpp = 2; label = 'R16';
      decode = (i, o) => {
        const v  = dv.getUint16(i, true) / 65535;
        out[o] = out[o+1] = out[o+2] = v; out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R8_UNORM:
      bpp = 1; label = 'R8';
      decode = (i, o) => {
        const v  = dv.getUint8(i) / 255;
        out[o] = out[o+1] = out[o+2] = v; out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_A8_UNORM:
      bpp = 1; label = 'A8';
      decode = (i, o) => {
        out[o] = out[o+1] = out[o+2] = 0;
        out[o+3] = dv.getUint8(i) / 255;
      }; break;

    case DXGI_FORMAT_B8G8R8A8_UNORM:
    case DXGI_FORMAT_B8G8R8A8_UNORM_SRGB:
      bpp = 4;
      label = dxgiFormat === DXGI_FORMAT_B8G8R8A8_UNORM_SRGB ? 'BGRA8 sRGB' : 'BGRA8';
      decode = (i, o) => {
        out[o]   = dv.getUint8(i + 2) / 255; // R ← B byte
        out[o+1] = dv.getUint8(i + 1) / 255; // G
        out[o+2] = dv.getUint8(i)     / 255; // B ← R byte
        out[o+3] = dv.getUint8(i + 3) / 255; // A
      }; break;

    case DXGI_FORMAT_B8G8R8X8_UNORM:
    case DXGI_FORMAT_B8G8R8X8_UNORM_SRGB:
      bpp = 4;
      label = dxgiFormat === DXGI_FORMAT_B8G8R8X8_UNORM_SRGB ? 'BGRX8 sRGB' : 'BGRX8';
      decode = (i, o) => {
        out[o]   = dv.getUint8(i + 2) / 255;
        out[o+1] = dv.getUint8(i + 1) / 255;
        out[o+2] = dv.getUint8(i)     / 255;
        out[o+3] = 1;
      }; break;

    // ── SNORM formats ──────────────────────────────────────────────────────
    case DXGI_FORMAT_R16G16B16A16_SNORM:
      bpp = 8; label = 'RGBA16 SNorm';
      decode = (i, o) => {
        out[o]   = snorm16(dv.getUint16(i,     true));
        out[o+1] = snorm16(dv.getUint16(i + 2, true));
        out[o+2] = snorm16(dv.getUint16(i + 4, true));
        out[o+3] = snorm16(dv.getUint16(i + 6, true));
      }; break;

    case DXGI_FORMAT_R8G8B8A8_SNORM:
      bpp = 4; label = 'RGBA8 SNorm';
      decode = (i, o) => {
        out[o]   = snorm8(dv.getUint8(i));
        out[o+1] = snorm8(dv.getUint8(i + 1));
        out[o+2] = snorm8(dv.getUint8(i + 2));
        out[o+3] = snorm8(dv.getUint8(i + 3));
      }; break;

    case DXGI_FORMAT_R16G16_SNORM:
      bpp = 4; label = 'RG16 SNorm';
      decode = (i, o) => {
        out[o]   = snorm16(dv.getUint16(i,     true));
        out[o+1] = snorm16(dv.getUint16(i + 2, true));
        out[o+2] = 0; out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R8G8_SNORM:
      bpp = 2; label = 'RG8 SNorm';
      decode = (i, o) => {
        out[o]   = snorm8(dv.getUint8(i));
        out[o+1] = snorm8(dv.getUint8(i + 1));
        out[o+2] = 0; out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R16_SNORM:
      bpp = 2; label = 'R16 SNorm';
      decode = (i, o) => {
        const v  = snorm16(dv.getUint16(i, true));
        out[o] = out[o+1] = out[o+2] = v; out[o+3] = 1;
      }; break;

    case DXGI_FORMAT_R8_SNORM:
      bpp = 1; label = 'R8 SNorm';
      decode = (i, o) => {
        const v  = snorm8(dv.getUint8(i));
        out[o] = out[o+1] = out[o+2] = v; out[o+3] = 1;
      }; break;

    default:
      return null;
  }

  for (let p = 0; p < numPixels; p++) {
    decode(p * bpp, p * 4);
  }

  return { out, bpp, label };
}

// ── Legacy uncompressed (DDPF_RGB / DDPF_LUMINANCE) ───────────────────────

/**
 * Decode legacy (pre-DX10) uncompressed DDS data using raw bit masks.
 * Handles RGB, RGBA and luminance formats at 8, 16, 24 and 32 bits per pixel.
 */
function decodeLegacyUncompressed(
  pixelData: Uint8Array,
  numPixels: number,
  pfFlags: number,
  bitCount: number,
  rMask: number,
  gMask: number,
  bMask: number,
  aMask: number,
): { out: Float32Array; label: string } {
  const dv  = new DataView(pixelData.buffer, pixelData.byteOffset, pixelData.byteLength);
  const out = new Float32Array(numPixels * 4);
  const bpp = bitCount >> 3; // bytes per pixel

  /** Extract a channel value [0, 1] using its bitmask. */
  function extractChan(packed: number, mask: number): number {
    if (!mask) return 0;
    let shift = 0;
    let m = mask;
    while (m && !(m & 1)) { m >>>= 1; shift++; }
    return ((packed >>> shift) & m) / m;
  }

  const isLuminance = !!(pfFlags & DDPF_LUMINANCE);
  const hasAlpha    = !!(pfFlags & (DDPF_ALPHAPIXELS | DDPF_ALPHA));
  const label = isLuminance
    ? (hasAlpha ? `L${bitCount / 2}A${bitCount / 2}` : `L${bitCount}`)
    : (hasAlpha ? `RGBA${bitCount / 4}` : `RGB${Math.round(bitCount / 3)}`);

  for (let p = 0; p < numPixels; p++) {
    const byteOff = p * bpp;
    let packed = 0;
    if      (bpp === 1) packed = dv.getUint8(byteOff);
    else if (bpp === 2) packed = dv.getUint16(byteOff, true);
    else if (bpp === 3) packed = dv.getUint8(byteOff) | (dv.getUint8(byteOff + 1) << 8) | (dv.getUint8(byteOff + 2) << 16);
    else                packed = dv.getUint32(byteOff, true);

    const o = p * 4;
    if (isLuminance) {
      const lum    = extractChan(packed, rMask);
      out[o] = out[o+1] = out[o+2] = lum;
      out[o+3] = hasAlpha ? extractChan(packed, aMask) : 1;
    } else {
      out[o]   = extractChan(packed, rMask);
      out[o+1] = extractChan(packed, gMask);
      out[o+2] = extractChan(packed, bMask);
      out[o+3] = hasAlpha ? extractChan(packed, aMask) : 1;
    }
  }

  return { out, label };
}

// ── Main parser ────────────────────────────────────────────────────────────

/**
 * Parse a DDS file buffer and return either BC block data (for GPU
 * decompression) or decoded RGBA float32 data (for uncompressed formats).
 *
 * @throws Error if the file is invalid, truncated, or uses an unsupported format.
 */
export function parseDDS(buffer: ArrayBuffer): DDSParseResult {
  const view = new DataView(buffer);

  if (buffer.byteLength < 128) {
    throw new Error('File too small to be a valid DDS file.');
  }

  const magic = view.getUint32(0, true);
  if (magic !== DDS_MAGIC) {
    throw new Error('Not a DDS file (invalid magic number).');
  }

  // DDS_HEADER starts at offset 4
  const headerSize = view.getUint32(4, true);
  if (headerSize !== 124) {
    throw new Error(`Invalid DDS header size: ${headerSize} (expected 124).`);
  }

  const height = view.getUint32(12, true);
  const width  = view.getUint32(16, true);

  // DDS_PIXELFORMAT starts at offset 76 (4 + 72)
  const pfSize  = view.getUint32(76, true);
  if (pfSize !== 32) {
    throw new Error(`Invalid pixel format size: ${pfSize} (expected 32).`);
  }

  const pfFlags = view.getUint32(80, true);
  const fourCC  = view.getUint32(84, true);

  // ── DX10 extended header ────────────────────────────────────────────────
  if (pfFlags & DDPF_FOURCC) {
    if (fourCC === FOURCC_DX10) {
      let dataOffset = 4 + 124; // after magic + header
      if (buffer.byteLength < dataOffset + 20) {
        throw new Error('DDS file too small for DX10 header.');
      }
      const dxgiFormat = view.getUint32(dataOffset, true);
      dataOffset += 20;

      // BC-compressed?
      const bcInfo = DXGI_TO_BC[dxgiFormat];
      if (bcInfo) {
        const blocksPerRow  = Math.ceil(width / 4);
        const blocksPerCol  = Math.ceil(height / 4);
        const expectedBytes = blocksPerRow * blocksPerCol * bcInfo.blockSize;
        if (buffer.byteLength < dataOffset + expectedBytes) {
          throw new Error(`DDS file truncated: expected ${expectedBytes} bytes of block data.`);
        }
        return {
          kind: 'compressed',
          width, height,
          format: bcInfo.gpuFormat,
          blockData: new Uint8Array(buffer, dataOffset, expectedBytes),
          blockSize: bcInfo.blockSize,
          blocksPerRow, blocksPerCol,
          formatLabel: bcInfo.label,
        };
      }

      // Uncompressed DXGI format
      const numPixels = width * height;
      const result = decodeDXGIUncompressed(
        dxgiFormat,
        new Uint8Array(buffer, dataOffset, buffer.byteLength - dataOffset),
        numPixels,
      );
      if (!result) {
        throw new Error(`Unsupported DXGI format: ${dxgiFormat}.`);
      }
      const expectedBytes = numPixels * result.bpp;
      if (buffer.byteLength - dataOffset < expectedBytes) {
        throw new Error(`DDS file truncated: expected ${expectedBytes} bytes for ${result.label}.`);
      }
      return {
        kind: 'uncompressed',
        width, height,
        float32Data: result.out,
        formatLabel: result.label,
      };
    }

    // ── Legacy FourCC (BC-compressed) ──────────────────────────────────────
    const bcInfo = FOURCC_TO_BC[fourCC];
    if (bcInfo) {
      const dataOffset    = 4 + 124;
      const blocksPerRow  = Math.ceil(width / 4);
      const blocksPerCol  = Math.ceil(height / 4);
      const expectedBytes = blocksPerRow * blocksPerCol * bcInfo.blockSize;
      if (buffer.byteLength < dataOffset + expectedBytes) {
        throw new Error(`DDS file truncated: expected ${expectedBytes} bytes of block data.`);
      }
      return {
        kind: 'compressed',
        width, height,
        format: bcInfo.gpuFormat,
        blockData: new Uint8Array(buffer, dataOffset, expectedBytes),
        blockSize: bcInfo.blockSize,
        blocksPerRow, blocksPerCol,
        formatLabel: bcInfo.label,
      };
    }

    const cc = String.fromCharCode(
      fourCC & 0xff, (fourCC >> 8) & 0xff,
      (fourCC >> 16) & 0xff, (fourCC >> 24) & 0xff,
    );
    throw new Error(`Unsupported FourCC: "${cc}".`);
  }

  // ── Legacy uncompressed (DDPF_RGB or DDPF_LUMINANCE) ───────────────────
  if (pfFlags & (DDPF_RGB | DDPF_LUMINANCE | DDPF_ALPHA)) {
    const bitCount = view.getUint32(88, true);
    const rMask    = view.getUint32(92, true);
    const gMask    = view.getUint32(96, true);
    const bMask    = view.getUint32(100, true);
    const aMask    = view.getUint32(104, true);

    const dataOffset    = 4 + 124;
    const bpp           = bitCount >> 3;
    const expectedBytes = width * height * bpp;
    if (buffer.byteLength < dataOffset + expectedBytes) {
      throw new Error(`DDS file truncated: expected ${expectedBytes} bytes for uncompressed data.`);
    }

    const pixelData = new Uint8Array(buffer, dataOffset, expectedBytes);
    const { out, label } = decodeLegacyUncompressed(
      pixelData, width * height, pfFlags, bitCount, rMask, gMask, bMask, aMask,
    );

    return {
      kind: 'uncompressed',
      width, height,
      float32Data: out,
      formatLabel: label,
    };
  }

  throw new Error(`Unsupported DDS pixel format (flags: 0x${pfFlags.toString(16)}).`);
}
