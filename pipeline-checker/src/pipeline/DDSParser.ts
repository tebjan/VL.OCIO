/**
 * DDS file parser — extracts BC-compressed block data from DirectDraw Surface files.
 *
 * Supports:
 * - Legacy FourCC codes: DXT1 (BC1), DXT3 (BC2), DXT5 (BC3), ATI1/BC4U (BC4), ATI2/BC5U (BC5)
 * - DX10 extended header: BC6H (unsigned/signed), BC7 (unorm/srgb)
 * - Maps to WebGPU GPUTextureFormat for native decompression
 */

export interface DDSParseResult {
  width: number;
  height: number;
  format: GPUTextureFormat;
  blockData: Uint8Array;
  /** Bytes per 4x4 block (8 for BC1/BC4, 16 for all others) */
  blockSize: number;
  /** Blocks per row (ceil(width / 4)) */
  blocksPerRow: number;
  /** Blocks per column (ceil(height / 4)) */
  blocksPerCol: number;
  /** Human-readable format name for display */
  formatLabel: string;
}

const DDS_MAGIC = 0x20534444; // "DDS " in little-endian

// DDS_PIXELFORMAT flags
const DDPF_FOURCC = 0x4;

// FourCC codes
const FOURCC_DXT1 = 0x31545844; // "DXT1"
const FOURCC_DXT3 = 0x33545844; // "DXT3"
const FOURCC_DXT5 = 0x35545844; // "DXT5"
const FOURCC_ATI1 = 0x31495441; // "ATI1"
const FOURCC_ATI2 = 0x32495441; // "ATI2"
const FOURCC_BC4U = 0x55344342; // "BC4U"
const FOURCC_BC5U = 0x55354342; // "BC5U"
const FOURCC_DX10 = 0x30315844; // "DX10"

// DXGI format values for BC formats
const DXGI_FORMAT_BC1_UNORM = 71;
const DXGI_FORMAT_BC1_UNORM_SRGB = 72;
const DXGI_FORMAT_BC2_UNORM = 74;
const DXGI_FORMAT_BC2_UNORM_SRGB = 75;
const DXGI_FORMAT_BC3_UNORM = 77;
const DXGI_FORMAT_BC3_UNORM_SRGB = 78;
const DXGI_FORMAT_BC4_UNORM = 80;
const DXGI_FORMAT_BC4_SNORM = 81;
const DXGI_FORMAT_BC5_UNORM = 83;
const DXGI_FORMAT_BC5_SNORM = 84;
const DXGI_FORMAT_BC6H_UF16 = 95;
const DXGI_FORMAT_BC6H_SF16 = 96;
const DXGI_FORMAT_BC7_UNORM = 98;
const DXGI_FORMAT_BC7_UNORM_SRGB = 99;

interface FormatInfo {
  gpuFormat: GPUTextureFormat;
  blockSize: number;
  label: string;
}

const DXGI_TO_FORMAT: Record<number, FormatInfo> = {
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

const FOURCC_TO_FORMAT: Record<number, FormatInfo> = {
  [FOURCC_DXT1]: { gpuFormat: 'bc1-rgba-unorm', blockSize: 8,  label: 'BC1 (DXT1)' },
  [FOURCC_DXT3]: { gpuFormat: 'bc2-rgba-unorm', blockSize: 16, label: 'BC2 (DXT3)' },
  [FOURCC_DXT5]: { gpuFormat: 'bc3-rgba-unorm', blockSize: 16, label: 'BC3 (DXT5)' },
  [FOURCC_ATI1]: { gpuFormat: 'bc4-r-unorm',    blockSize: 8,  label: 'BC4 (ATI1)' },
  [FOURCC_ATI2]: { gpuFormat: 'bc5-rg-unorm',   blockSize: 16, label: 'BC5 (ATI2)' },
  [FOURCC_BC4U]: { gpuFormat: 'bc4-r-unorm',    blockSize: 8,  label: 'BC4' },
  [FOURCC_BC5U]: { gpuFormat: 'bc5-rg-unorm',   blockSize: 16, label: 'BC5' },
};

/**
 * Parse a DDS file buffer and extract BC-compressed block data.
 * Only supports 2D textures with BC compression (mip 0 only).
 *
 * @throws Error if the file is not a valid DDS, uses an unsupported format,
 *         or does not contain BC-compressed data.
 */
export function parseDDS(buffer: ArrayBuffer): DDSParseResult {
  const view = new DataView(buffer);

  if (buffer.byteLength < 128) {
    throw new Error('File too small to be a valid DDS file.');
  }

  // Validate magic number
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
  const width = view.getUint32(16, true);

  // DDS_PIXELFORMAT starts at offset 4 + 72 = 76
  const pfSize = view.getUint32(76, true);
  if (pfSize !== 32) {
    throw new Error(`Invalid pixel format size: ${pfSize} (expected 32).`);
  }

  const pfFlags = view.getUint32(80, true);
  const fourCC = view.getUint32(84, true);

  if (!(pfFlags & DDPF_FOURCC)) {
    throw new Error('DDS file does not use FourCC pixel format. Only BC-compressed DDS files are supported.');
  }

  let formatInfo: FormatInfo;
  let dataOffset = 4 + 124; // After magic + header

  if (fourCC === FOURCC_DX10) {
    // DX10 extended header (20 bytes) follows the main header
    if (buffer.byteLength < dataOffset + 20) {
      throw new Error('DDS file too small for DX10 header.');
    }

    const dxgiFormat = view.getUint32(dataOffset, true);
    dataOffset += 20;

    const info = DXGI_TO_FORMAT[dxgiFormat];
    if (!info) {
      throw new Error(`Unsupported DXGI format: ${dxgiFormat}. Only BC1-BC7 formats are supported.`);
    }
    formatInfo = info;
  } else {
    const info = FOURCC_TO_FORMAT[fourCC];
    if (!info) {
      const cc = String.fromCharCode(
        fourCC & 0xff,
        (fourCC >> 8) & 0xff,
        (fourCC >> 16) & 0xff,
        (fourCC >> 24) & 0xff,
      );
      throw new Error(`Unsupported FourCC: "${cc}". Only BC-compressed DDS files are supported.`);
    }
    formatInfo = info;
  }

  const blocksPerRow = Math.ceil(width / 4);
  const blocksPerCol = Math.ceil(height / 4);
  const expectedBytes = blocksPerRow * blocksPerCol * formatInfo.blockSize;

  if (buffer.byteLength < dataOffset + expectedBytes) {
    throw new Error(
      `DDS file truncated: expected ${expectedBytes} bytes of block data, ` +
      `but only ${buffer.byteLength - dataOffset} available.`
    );
  }

  const blockData = new Uint8Array(buffer, dataOffset, expectedBytes);

  return {
    width,
    height,
    format: formatInfo.gpuFormat,
    blockData,
    blockSize: formatInfo.blockSize,
    blocksPerRow,
    blocksPerCol,
    formatLabel: formatInfo.label,
  };
}
