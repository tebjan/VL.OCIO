/**
 * @vl-ocio/webgpu-bc-encoder
 *
 * GPU-based BC1-7 texture encoding via WebGPU compute shaders.
 * Each format processes 4x4 pixel blocks in parallel on the GPU.
 */

export type BCFormat = 'bc1' | 'bc2' | 'bc3' | 'bc4' | 'bc5' | 'bc6h' | 'bc7';
export type BCQuality = 'fast' | 'normal' | 'high';

export interface BCEncodeResult {
  data: Uint8Array;
  format: BCFormat;
  width: number;              // Padded to multiple of 4
  height: number;
  originalWidth: number;
  originalHeight: number;
  blocksPerRow: number;
  blockSize: number;           // 8 for BC1/BC4, 16 for others
  compressionTimeMs: number;
}

export interface BCMetrics {
  psnrR: number;
  psnrG: number;
  psnrB: number;
  psnrCombined: number;
  maxErrorR: number;
  maxErrorG: number;
  maxErrorB: number;
  maxErrorCombined: number;
  mseR: number;
  mseG: number;
  mseB: number;
}

/** Block size in bytes per format. BC1/BC4 = 8, all others = 16. */
export const BC_BLOCK_SIZE: Record<BCFormat, number> = {
  bc1: 8,
  bc2: 16,
  bc3: 16,
  bc4: 8,
  bc5: 16,
  bc6h: 16,
  bc7: 16,
};

/** Maps BCFormat to WebGPU GPUTextureFormat for hardware decompression. */
export const BC_FORMAT_TO_GPU: Record<BCFormat, GPUTextureFormat> = {
  bc1: 'bc1-rgba-unorm',
  bc2: 'bc2-rgba-unorm',
  bc3: 'bc3-rgba-unorm',
  bc4: 'bc4-r-unorm',
  bc5: 'bc5-rg-unorm',
  bc6h: 'bc6h-rgb-ufloat',
  bc7: 'bc7-rgba-unorm',
};

export { BCEncoder } from './encoder';
export { BCMetricsComputer } from './metrics';
export type { BCFormatHandler } from './formats/handler';
