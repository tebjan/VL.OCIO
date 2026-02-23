import type { BCFormat, BCQuality, BCEncodeResult } from './index';
import { BC_BLOCK_SIZE } from './index';
import type { BCFormatHandler } from './formats/handler';
import { bc1Handler } from './formats/bc1';
import { bc2Handler } from './formats/bc2';
import { bc3Handler } from './formats/bc3';
import { bc4Handler } from './formats/bc4';
import { bc5Handler } from './formats/bc5';
import { bc6hHandler } from './formats/bc6h';
import { bc7Handler } from './formats/bc7';

const FORMAT_HANDLERS: Record<BCFormat, BCFormatHandler> = {
  bc1: bc1Handler,
  bc2: bc2Handler,
  bc3: bc3Handler,
  bc4: bc4Handler,
  bc5: bc5Handler,
  bc6h: bc6hHandler,
  bc7: bc7Handler,
};

/**
 * GPU-based BC texture encoder using WebGPU compute shaders.
 *
 * Lazily creates and caches compute pipelines per format+quality.
 * Dispatches ceil(width/4) * ceil(height/4) workgroups per encode.
 * Reads back compressed block data via staging buffer.
 */
export class BCEncoder {
  private device: GPUDevice;
  private pipelines: Map<string, GPUComputePipeline> = new Map();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /** Get the format handler for a given format (useful for alpha warnings). */
  static getHandler(format: BCFormat): BCFormatHandler {
    return FORMAT_HANDLERS[format];
  }

  /**
   * Get or create a cached compute pipeline for a format+quality combination.
   */
  private getPipeline(format: BCFormat, quality: BCQuality): GPUComputePipeline {
    const key = `${format}:${quality}`;
    let pipeline = this.pipelines.get(key);
    if (!pipeline) {
      const handler = FORMAT_HANDLERS[format];
      pipeline = handler.createPipeline(this.device, quality);
      this.pipelines.set(key, pipeline);
    }
    return pipeline;
  }

  /**
   * Encode a source texture to a BC compressed format.
   * @param source - The rgba32float source texture to compress
   * @param format - Target BC format (bc1-bc7)
   * @param quality - Encoding quality (fast/normal/high)
   * @returns Compressed block data with metadata
   */
  async encode(
    source: GPUTexture,
    format: BCFormat,
    quality: BCQuality = 'normal'
  ): Promise<BCEncodeResult> {
    const startTime = performance.now();

    const originalWidth = source.width;
    const originalHeight = source.height;
    const paddedWidth = Math.ceil(originalWidth / 4) * 4;
    const paddedHeight = Math.ceil(originalHeight / 4) * 4;
    const blocksPerRow = paddedWidth / 4;
    const blocksPerCol = paddedHeight / 4;
    const blockSize = BC_BLOCK_SIZE[format];
    const totalBlocks = blocksPerRow * blocksPerCol;
    const outputBytes = totalBlocks * blockSize;

    // Get or create compute pipeline
    const pipeline = this.getPipeline(format, quality);
    console.log(`[BCEncoder] Encoding ${format} quality=${quality} ${originalWidth}x${originalHeight} (${totalBlocks} blocks)`);

    // Push error scope to catch validation errors during encode
    this.device.pushErrorScope('validation');

    // Create params uniform buffer (width, height, quality)
    const qualityValue = quality === 'fast' ? 0 : quality === 'normal' ? 1 : 2;
    const paramsData = new Uint32Array([originalWidth, originalHeight, qualityValue]);
    const paramsBuffer = this.device.createBuffer({
      size: 16, // 3 x u32 + padding for 16-byte alignment
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    // Create output storage buffer
    const outputBuffer = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: outputBuffer } },
        { binding: 2, resource: { buffer: paramsBuffer } },
      ],
    });

    // Dispatch compute shader
    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(blocksPerRow, blocksPerCol, 1);
    pass.end();

    // Create staging buffer for readback
    const stagingBuffer = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, outputBytes);

    this.device.queue.submit([commandEncoder.finish()]);

    // Check for validation errors from the encode dispatch
    const gpuError = await this.device.popErrorScope();
    if (gpuError) {
      console.error(`[BCEncoder] GPU validation error during ${format} encode: ${gpuError.message}`);
    }

    // Read back results
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(stagingBuffer.getMappedRange()).slice();
    stagingBuffer.unmap();

    // Quick sanity check: are all output bytes zero?
    let allZero = true;
    for (let i = 0; i < Math.min(data.length, 256); i++) {
      if (data[i] !== 0) { allZero = false; break; }
    }
    if (allZero) {
      console.error(`[BCEncoder] WARNING: ${format} output is all zeros — shader may have failed to execute`);
    }

    // Clean up per-encode resources
    paramsBuffer.destroy();
    outputBuffer.destroy();
    stagingBuffer.destroy();

    const compressionTimeMs = performance.now() - startTime;
    console.log(`[BCEncoder] ${format} encode complete in ${compressionTimeMs.toFixed(1)}ms`);

    return {
      data,
      format,
      width: paddedWidth,
      height: paddedHeight,
      originalWidth,
      originalHeight,
      blocksPerRow,
      blockSize,
      compressionTimeMs,
    };
  }

  /** Release all cached GPU resources. */
  destroy(): void {
    this.pipelines.clear();
  }
}
