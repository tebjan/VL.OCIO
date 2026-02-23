import type { PipelineStage } from '../PipelineStage';
import { BC_FORMAT_TO_GPU, type BCEncodeResult } from '@vl-ocio/webgpu-bc-encoder';
import { mipLevelCount, encodeMipmaps } from '../TextureUtils';
import decompressWGSL from '../shaders/bc-decompress.wgsl?raw';
import deltaWGSL from '../shaders/bc-delta.wgsl?raw';

/**
 * Stage 3: BC Decompress
 *
 * Takes raw BC block data from BCCompressStage (Stage 2) and decompresses
 * it back to an rgba16float render target using WebGPU native
 * texture-compression-bc hardware decompression.
 *
 * Supports a "delta view" mode that shows the compression error:
 * abs(original - decompressed) * amplification, useful for visualizing
 * BC compression artifacts.
 */
export class BCDecompressStage implements PipelineStage {
  readonly name = 'BC Decompress';
  readonly index = 2;
  enabled: boolean;
  available: boolean;
  output: GPUTexture | null = null;

  /** When true, output shows amplified error instead of decompressed image. */
  showDelta = false;
  /** Amplification factor for delta visualization (1-100). */
  amplification = 10;
  /** Whether input is linear/HDR (true) or already perceptually encoded like sRGB (false). */
  isLinear = true;
  /**
   * Override reference texture for delta visualization.
   * When BC6H + sRGB, this should be the linearized source (not raw sRGB)
   * so the delta compares like-for-like in linear space.
   */
  deltaReference: GPUTexture | null = null;

  private device!: GPUDevice;
  private decompressedTarget: GPUTexture | null = null;
  private deltaTarget: GPUTexture | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private deltaPipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private bcTexture: GPUTexture | null = null;
  private deltaUniformBuffer: GPUBuffer | null = null;
  /** Track last uploaded result to skip redundant destroy/recreate cycles. */
  private lastUploadedResult: BCEncodeResult | null = null;

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

    this.deltaUniformBuffer = device.createBuffer({
      size: 16, // DeltaParams: f32 amplification + 3x f32 padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'BC Delta Params',
    });

    this.createRenderTargets(width, height);
    this.createPipelines();
  }

  resize(width: number, height: number): void {
    if (!this.available) return;
    this.decompressedTarget?.destroy();
    this.deltaTarget?.destroy();
    this.createRenderTargets(width, height);
  }

  private createRenderTargets(width: number, height: number): void {
    const usage =
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC;

    const mips = mipLevelCount(width, height);

    this.decompressedTarget = this.device.createTexture({
      size: [width, height],
      format: 'rgba16float',
      mipLevelCount: mips,
      usage,
      label: 'BC Decompress Output',
    });

    this.deltaTarget = this.device.createTexture({
      size: [width, height],
      format: 'rgba16float',
      mipLevelCount: mips,
      usage,
      label: 'BC Delta Output',
    });

    // Don't set this.output here — it stays null until encode() actually
    // renders data. This prevents filmstrip from showing uninitialized GPU memory.
  }

  private createPipelines(): void {
    // Normal decompress pipeline
    const decompressModule = this.device.createShaderModule({
      label: 'BC Decompress Shader',
      code: decompressWGSL,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: decompressModule,
        entryPoint: 'vs',
      },
      fragment: {
        module: decompressModule,
        entryPoint: 'fs',
        targets: [{ format: 'rgba16float', blend: undefined }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Delta visualization pipeline
    const deltaModule = this.device.createShaderModule({
      label: 'BC Delta Shader',
      code: deltaWGSL,
    });

    this.deltaPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: deltaModule,
        entryPoint: 'vs',
      },
      fragment: {
        module: deltaModule,
        entryPoint: 'fs',
        targets: [{ format: 'rgba16float', blend: undefined }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /**
   * Upload BC block data as a native compressed texture.
   * Called when BCCompressStage has a new encodeResult.
   * Returns true if data was actually uploaded, false if skipped (same data).
   */
  uploadBCData(encodeResult: BCEncodeResult): boolean {
    if (!this.available) return false;

    // Skip if the exact same encode result is already uploaded.
    // The async encode effect can re-run due to unrelated state changes
    // (e.g. stage selection) — destroying and recreating the bcTexture
    // would cause a race with in-flight GPU commands using the old texture.
    if (this.lastUploadedResult === encodeResult) return false;

    this.bcTexture?.destroy();
    this.lastUploadedResult = encodeResult;

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

    return true;
  }

  encode(
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    _uniforms: GPUBuffer
  ): void {
    if (!this.bcTexture || !this.pipeline || !this.decompressedTarget) {
      // No BC data available — pass through input
      this.output = input;
      return;
    }

    // Pass 1: Normal BC decompress → decompressedTarget
    const decompressBindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.bcTexture.createView() },
        { binding: 1, resource: this.sampler! },
      ],
    });

    const decompressPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.decompressedTarget.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
        loadOp: 'clear' as GPULoadOp,
        storeOp: 'store' as GPUStoreOp,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    decompressPass.setPipeline(this.pipeline);
    decompressPass.setBindGroup(0, decompressBindGroup);
    decompressPass.draw(3);
    decompressPass.end();

    // Pass 2 (optional): Delta visualization → deltaTarget
    if (this.showDelta && this.deltaPipeline && this.deltaTarget && this.deltaUniformBuffer) {
      // Update delta params: amplification + isLinear flag
      const data = new Float32Array([this.amplification, this.isLinear ? 1.0 : 0.0, 0, 0]);
      this.device.queue.writeBuffer(this.deltaUniformBuffer, 0, data);

      const deltaBindGroup = this.device.createBindGroup({
        layout: this.deltaPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: (this.deltaReference ?? input).createView() }, // original source (or linearized for BC6H+sRGB)
          { binding: 1, resource: this.decompressedTarget.createView() },   // decompressed
          { binding: 2, resource: this.sampler! },
          { binding: 3, resource: { buffer: this.deltaUniformBuffer } },
        ],
      });

      const deltaPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.deltaTarget.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
          loadOp: 'clear' as GPULoadOp,
          storeOp: 'store' as GPUStoreOp,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      deltaPass.setPipeline(this.deltaPipeline);
      deltaPass.setBindGroup(0, deltaBindGroup);
      deltaPass.draw(3);
      deltaPass.end();

      this.output = this.deltaTarget;
      encodeMipmaps(this.device, encoder, this.deltaTarget);
    } else {
      this.output = this.decompressedTarget;
      encodeMipmaps(this.device, encoder, this.decompressedTarget);
    }
  }

  /**
   * Always returns the decompressed (non-delta) texture.
   * Used by the color pipeline which should always receive clean decompressed data.
   */
  getDecompressedOutput(): GPUTexture | null {
    return this.decompressedTarget;
  }

  destroy(): void {
    this.decompressedTarget?.destroy();
    this.deltaTarget?.destroy();
    this.bcTexture?.destroy();
    this.deltaUniformBuffer?.destroy();
    this.decompressedTarget = null;
    this.deltaTarget = null;
    this.bcTexture = null;
    this.deltaUniformBuffer = null;
    this.lastUploadedResult = null;
    this.output = null;
  }
}
