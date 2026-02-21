import type { BCQuality } from '../index';

/**
 * Per-format handler interface — each BC format provides its own
 * WGSL shader source and pipeline configuration.
 */
export interface BCFormatHandler {
  /** Block size in bytes (8 for BC1/BC4, 16 for others). */
  readonly blockSize: number;

  /** Words (u32) per block in the output storage buffer. */
  readonly wordsPerBlock: number;

  /** Workgroup size used by the compute shader. */
  readonly workgroupSize: [number, number, number];

  /** Whether this format supports alpha (false for BC6H). */
  readonly supportsAlpha: boolean;

  /** Warning message when alpha is lost (BC6H only). */
  readonly alphaWarning?: string;

  /**
   * Create the compute pipeline for this format.
   * @param device - The WebGPU device
   * @param quality - Encoding quality level
   * @returns A configured compute pipeline
   */
  createPipeline(device: GPUDevice, quality: BCQuality): GPUComputePipeline;
}
