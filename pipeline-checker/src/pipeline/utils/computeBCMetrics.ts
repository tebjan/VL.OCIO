import { BCMetricsComputer, type BCEncodeResult } from '@vl-ocio/webgpu-bc-encoder';
import type { PipelineBCMetrics } from '../types/BCMetrics';

/**
 * Compute BC quality metrics by comparing the original float texture
 * with the BC-decompressed texture, then enrich with encode metadata.
 *
 * Runs asynchronously (GPU compute dispatch + readback). The UI should
 * display the most recent completed result, updating whenever a new
 * encode finishes.
 */
export async function computeBCMetrics(
  originalTexture: GPUTexture,
  decompressedTexture: GPUTexture,
  encodeResult: BCEncodeResult,
  metricsComputer: BCMetricsComputer
): Promise<PipelineBCMetrics> {
  const raw = await metricsComputer.computeMetrics(originalTexture, decompressedTexture);

  // Compression ratio: uncompressed rgba32float (16 bytes/pixel) vs encoded
  const uncompressedBytes = encodeResult.originalWidth * encodeResult.originalHeight * 16;
  const compressionRatio = uncompressedBytes / encodeResult.data.byteLength;

  return {
    psnr: {
      r: raw.psnrR,
      g: raw.psnrG,
      b: raw.psnrB,
      combined: raw.psnrCombined,
    },
    maxError: {
      r: raw.maxErrorR,
      g: raw.maxErrorG,
      b: raw.maxErrorB,
      combined: raw.maxErrorCombined,
    },
    mse: {
      r: raw.mseR,
      g: raw.mseG,
      b: raw.mseB,
      combined: raw.mseCombined,
    },
    compressionRatio,
    encodedSizeBytes: encodeResult.data.byteLength,
    encodeTimeMs: encodeResult.compressionTimeMs,
    format: encodeResult.format,
    originalWidth: encodeResult.originalWidth,
    originalHeight: encodeResult.originalHeight,
    paddedWidth: encodeResult.width,
    paddedHeight: encodeResult.height,
  };
}
