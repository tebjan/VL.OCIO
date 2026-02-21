import type { BCQuality } from '../index';

/**
 * Per-format handler interface — each BC format provides its own
 * WGSL shader source and pipeline configuration.
 *
 * Implementations created in task 5.2 when shaders are ported.
 */
export interface BCFormatHandler {
  /** Block size in bytes (8 for BC1/BC4, 16 for others). */
  readonly blockSize: number;

  /** Workgroup size used by the compute shader. */
  readonly workgroupSize: [number, number, number];

  /**
   * Create the compute pipeline for this format.
   * @param device - The WebGPU device
   * @param quality - Encoding quality level
   * @returns A configured compute pipeline
   */
  createPipeline(device: GPUDevice, quality: BCQuality): GPUComputePipeline;
}
