import type { PipelineStage } from '../PipelineStage';
import { BC_FORMAT_TO_GPU, type BCEncodeResult } from '@vl-ocio/webgpu-bc-encoder';
import decompressWGSL from '../shaders/bc-decompress.wgsl?raw';

/**
 * Stage 3: BC Decompress
 *
 * Takes raw BC block data from BCCompressStage (Stage 2) and decompresses
 * it back to an rgba32float render target using WebGPU native
 * texture-compression-bc hardware decompression.
 *
 * The BC blocks are uploaded as a native compressed texture, and the GPU
 * hardware automatically decompresses during sampling via a fullscreen
 * triangle pass.
 */
export class BCDecompressStage implements PipelineStage {
  readonly name = 'BC Decompress';
  readonly index = 2;
  enabled: boolean;
  available: boolean;
  output: GPUTexture | null = null;

  private device!: GPUDevice;
  private renderTarget: GPUTexture | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private bcTexture: GPUTexture | null = null;

  constructor(hasBC: boolean) {
    this.available = hasBC;
    this.enabled = hasBC;
  }

  initialize(device: GPUDevice, width: number, height: number): void {
    if (!this.available) return;

    this.device = device;

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.createRenderTarget(width, height);
    this.createPipeline();
  }

  resize(width: number, height: number): void {
    if (!this.available) return;
    this.renderTarget?.destroy();
    this.createRenderTarget(width, height);
  }

  private createRenderTarget(width: number, height: number): void {
    this.renderTarget = this.device.createTexture({
      size: [width, height],
      format: 'rgba32float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
      label: 'Stage 3: BC Decompress',
    });
    this.output = this.renderTarget;
  }

  private createPipeline(): void {
    const shaderModule = this.device.createShaderModule({
      label: 'BC Decompress Shader',
      code: decompressWGSL,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [{
          format: 'rgba32float',
          blend: undefined, // REQUIRED: no hardware blending on float32
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /**
   * Upload BC block data as a native compressed texture.
   * Called by PipelineRenderer when BCCompressStage has a new encodeResult.
   */
  uploadBCData(encodeResult: BCEncodeResult): void {
    if (!this.available) return;
    this.bcTexture?.destroy();

    const gpuFormat = BC_FORMAT_TO_GPU[encodeResult.format];

    this.bcTexture = this.device.createTexture({
      size: [encodeResult.width, encodeResult.height],
      format: gpuFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: `BC Texture (${encodeResult.format})`,
    });

    this.device.queue.writeTexture(
      { texture: this.bcTexture },
      encodeResult.data as Uint8Array<ArrayBuffer>,
      { bytesPerRow: encodeResult.blocksPerRow * encodeResult.blockSize },
      { width: encodeResult.width, height: encodeResult.height }
    );
  }

  encode(
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    _uniforms: GPUBuffer
  ): void {
    if (!this.bcTexture || !this.pipeline || !this.renderTarget) {
      // No BC data available — pass through input
      this.output = input;
      return;
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.bcTexture.createView() },
        { binding: 1, resource: this.sampler! },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTarget.createView(),
        loadOp: 'clear' as GPULoadOp,
        storeOp: 'store' as GPUStoreOp,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3); // Fullscreen triangle
    pass.end();

    this.output = this.renderTarget;
  }

  destroy(): void {
    this.renderTarget?.destroy();
    this.bcTexture?.destroy();
    this.renderTarget = null;
    this.bcTexture = null;
    this.output = null;
  }
}
