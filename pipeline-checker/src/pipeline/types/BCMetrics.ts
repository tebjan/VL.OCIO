import type { BCFormat } from '@vl-ocio/webgpu-bc-encoder';

/** Per-channel + combined metrics. */
export interface ChannelMetrics {
  r: number;
  g: number;
  b: number;
  combined: number;
}

/**
 * Enriched BC compression quality metrics for UI display.
 * Combines the raw encoder metrics with encode metadata.
 */
export interface PipelineBCMetrics {
  /** Peak Signal-to-Noise Ratio (dB) per channel and combined. */
  psnr: ChannelMetrics;
  /** Maximum absolute error per channel and combined. */
  maxError: ChannelMetrics;
  /** Mean Squared Error per channel and combined. */
  mse: ChannelMetrics;
  /** Compression ratio (e.g. 8 for 8:1). */
  compressionRatio: number;
  /** Encoded data size in bytes. */
  encodedSizeBytes: number;
  /** Encoding time in milliseconds. */
  encodeTimeMs: number;
  /** BC format used. */
  format: BCFormat;
  /** Original image dimensions. */
  originalWidth: number;
  originalHeight: number;
  /** Padded dimensions (multiple of 4 for BC). */
  paddedWidth: number;
  paddedHeight: number;
}
