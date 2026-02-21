import type { BCMetrics } from './index';
import bcMetricsShader from './shaders/bc-metrics.wgsl?raw';

/**
 * Computes quality metrics between an original texture and a
 * BC-decompressed texture using a GPU compute shader.
 *
 * Phase 1 (GPU): per-pixel squared error + absolute error → storage buffer.
 * Phase 2 (CPU): reduction over readback data → MSE, max error, PSNR.
 */
export class BCMetricsComputer {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  private ensurePipeline(): GPUComputePipeline {
    if (!this.pipeline) {
      const module = this.device.createShaderModule({ code: bcMetricsShader });
      this.pipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
    }
    return this.pipeline;
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
    const pipeline = this.ensurePipeline();

    const width = original.width;
    const height = original.height;
    const pixelCount = width * height;

    // 6 floats per pixel: SE_R, SE_G, SE_B, AE_R, AE_G, AE_B
    const floatsPerPixel = 6;
    const errorBufferSize = pixelCount * floatsPerPixel * 4; // bytes

    // Uniform buffer: width, height (2 x u32, padded to 8 bytes minimum)
    const paramsData = new Uint32Array([width, height]);
    const paramsBuffer = this.device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    // Error output storage buffer
    const errorBuffer = this.device.createBuffer({
      size: errorBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Staging buffer for CPU readback
    const stagingBuffer = this.device.createBuffer({
      size: errorBufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: original.createView() },
        { binding: 1, resource: decompressed.createView() },
        { binding: 2, resource: { buffer: errorBuffer } },
        { binding: 3, resource: { buffer: paramsBuffer } },
      ],
    });

    // Dispatch: 8x8 workgroups
    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);

    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
    pass.end();

    commandEncoder.copyBufferToBuffer(errorBuffer, 0, stagingBuffer, 0, errorBufferSize);
    this.device.queue.submit([commandEncoder.finish()]);

    // Read back error data
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const errors = new Float32Array(stagingBuffer.getMappedRange()).slice();
    stagingBuffer.unmap();

    // Clean up per-call resources
    paramsBuffer.destroy();
    errorBuffer.destroy();
    stagingBuffer.destroy();

    // CPU-side reduction: sum SE for MSE, max AE for max error
    const sumSE = [0, 0, 0];
    const maxAE = [0, 0, 0];

    for (let i = 0; i < pixelCount; i++) {
      const base = i * 6;
      sumSE[0] += errors[base + 0];
      sumSE[1] += errors[base + 1];
      sumSE[2] += errors[base + 2];
      maxAE[0] = Math.max(maxAE[0], errors[base + 3]);
      maxAE[1] = Math.max(maxAE[1], errors[base + 4]);
      maxAE[2] = Math.max(maxAE[2], errors[base + 5]);
    }

    const mseR = sumSE[0] / pixelCount;
    const mseG = sumSE[1] / pixelCount;
    const mseB = sumSE[2] / pixelCount;
    const mseCombined = (mseR + mseG + mseB) / 3;

    const psnrR = mseR > 0 ? 10 * Math.log10(1.0 / mseR) : Infinity;
    const psnrG = mseG > 0 ? 10 * Math.log10(1.0 / mseG) : Infinity;
    const psnrB = mseB > 0 ? 10 * Math.log10(1.0 / mseB) : Infinity;
    const psnrCombined = mseCombined > 0 ? 10 * Math.log10(1.0 / mseCombined) : Infinity;

    const maxErrorCombined = Math.max(maxAE[0], maxAE[1], maxAE[2]);

    return {
      psnrR,
      psnrG,
      psnrB,
      psnrCombined,
      maxErrorR: maxAE[0],
      maxErrorG: maxAE[1],
      maxErrorB: maxAE[2],
      maxErrorCombined,
      mseR,
      mseG,
      mseB,
      mseCombined,
    };
  }

  destroy(): void {
    this.pipeline = null;
  }
}
