import type { BCMetrics } from './index';

/**
 * Computes quality metrics between an original texture and a
 * BC-decompressed texture using a GPU compute shader.
 *
 * Metrics: per-channel PSNR, MSE, and max error.
 */
export class BCMetricsComputer {
  private device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /**
   * Compare original vs decompressed textures and compute error metrics.
   * @param original - The source rgba32float texture
   * @param decompressed - The BC-decompressed rgba32float texture
   * @returns Per-channel PSNR, MSE, and max error
   */
  async computeMetrics(
    original: GPUTexture,
    decompressed: GPUTexture
  ): Promise<BCMetrics> {
    // TODO (task 5.4): Dispatch bc-metrics.wgsl compute shader
    // TODO (task 5.4): Read back reduction results

    void this.device;
    void original;
    void decompressed;

    // Placeholder: return zero metrics
    return {
      psnrR: 0,
      psnrG: 0,
      psnrB: 0,
      psnrCombined: 0,
      maxErrorR: 0,
      maxErrorG: 0,
      maxErrorB: 0,
      maxErrorCombined: 0,
      mseR: 0,
      mseG: 0,
      mseB: 0,
    };
  }

  destroy(): void {
    // TODO (task 5.4): Release cached pipelines and buffers
  }
}
