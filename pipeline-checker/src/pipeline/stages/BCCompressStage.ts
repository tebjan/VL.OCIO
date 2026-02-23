import type { PipelineStage } from '../PipelineStage';
import { BCEncoder, type BCFormat, type BCQuality, type BCEncodeResult } from '@vl-ocio/webgpu-bc-encoder';
import srgbToLinearWGSL from '../shaders/srgb-to-linear.wgsl?raw';

/**
 * Stage 2: BC Compress (Compute Stage)
 *
 * Unlike the color pipeline stages (4-9) which use fragment shaders,
 * this is a compute stage that dispatches the BC encoder.
 *
 * The "output texture" for filmstrip display is the original input
 * (BC block data is not directly displayable).
 *
 * The async encode runs outside the main render loop. Subsequent
 * frames with unchanged parameters reuse the cached encodeResult.
 *
 * When BC6H format is selected with sRGB input, the stage automatically
 * converts sRGB → Linear Rec.709 before compression, since BC6H stores
 * linear HDR data. The linearized source is exposed for delta reference.
 */
export class BCCompressStage implements PipelineStage {
  readonly name = 'BC Compress';
  readonly index = 1;
  enabled: boolean;
  available: boolean;
  output: GPUTexture | null = null;

  /** Cached encode result for BCDecompressStage to consume. */
  encodeResult: BCEncodeResult | null = null;

  /** Input color space index (from PipelineSettings.inputColorSpace). */
  inputColorSpace = 0;

  /**
   * When BC6H + sRGB, this holds the linearized source texture.
   * Used by BCDecompressStage as delta reference instead of raw sRGB source.
   */
  linearizedSource: GPUTexture | null = null;

  private device: GPUDevice;
  private encoder: BCEncoder | null;
  private format: BCFormat = 'bc6h';
  private quality: BCQuality = 'normal';

  /** Track last encode parameters to avoid redundant encodes. */
  private lastEncodeKey = '';
  private pendingEncode: Promise<BCEncodeResult> | null = null;

  // sRGB → linear conversion resources
  private linearizePipeline: GPURenderPipeline | null = null;
  private linearizeSampler: GPUSampler | null = null;

  constructor(device: GPUDevice, hasBC: boolean) {
    this.device = device;
    this.available = hasBC;
    this.enabled = hasBC;
    this.encoder = hasBC ? new BCEncoder(device) : null;

    if (hasBC) {
      this.createLinearizePipeline();
    }
  }

  private createLinearizePipeline(): void {
    const module = this.device.createShaderModule({
      label: 'sRGB-to-Linear Shader',
      code: srgbToLinearWGSL,
    });

    this.linearizePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [{ format: 'rgba16float', blend: undefined }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.linearizeSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  /** Whether BC6H + sRGB requires linearization before encode. */
  private needsLinearize(): boolean {
    return this.format === 'bc6h' && this.inputColorSpace === 5;
  }

  /**
   * Run sRGB → linear conversion, return the linearized texture.
   * Creates/resizes the target as needed.
   */
  private linearize(input: GPUTexture): GPUTexture {
    // Create/resize target
    if (!this.linearizedSource ||
        this.linearizedSource.width !== input.width ||
        this.linearizedSource.height !== input.height) {
      this.linearizedSource?.destroy();
      this.linearizedSource = this.device.createTexture({
        size: [input.width, input.height],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        label: 'sRGB-to-Linear Target',
      });
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.linearizePipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.linearizeSampler! },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.linearizedSource.createView(),
        loadOp: 'clear' as GPULoadOp,
        storeOp: 'store' as GPUStoreOp,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    pass.setPipeline(this.linearizePipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    return this.linearizedSource;
  }

  initialize(_device: GPUDevice, _width: number, _height: number): void {
    // No render target needed — this stage writes to a storage buffer.
    // The encoder handles buffer allocation internally.
  }

  resize(_width: number, _height: number): void {
    // Encoder handles resize internally on next encode() call.
    // Invalidate cache so next frame re-encodes at new size.
    this.lastEncodeKey = '';
  }

  setFormat(format: BCFormat): void {
    if (format !== this.format) {
      this.format = format;
      this.lastEncodeKey = '';
    }
  }

  getFormat(): BCFormat {
    return this.format;
  }

  setQuality(quality: BCQuality): void {
    if (quality !== this.quality) {
      this.quality = quality;
      this.lastEncodeKey = '';
    }
  }

  getQuality(): BCQuality {
    return this.quality;
  }

  /**
   * Synchronous encode — records no GPU commands. Sets output to input
   * (passthrough for filmstrip display). Actual BC encoding is async
   * via runEncode().
   */
  encode(
    _encoder: GPUCommandEncoder,
    input: GPUTexture,
    _uniforms: GPUBuffer
  ): void {
    // BC block data is not displayable — pass through the input
    this.output = input;
  }

  /**
   * Run the async BC encode on the given input texture.
   * Caches results when format/quality/dimensions haven't changed.
   * Call this outside the main render loop (before render()).
   *
   * When BC6H + sRGB, automatically linearizes input before encoding.
   */
  async runEncode(input: GPUTexture): Promise<BCEncodeResult | null> {
    if (!this.enabled || !this.encoder) {
      this.encodeResult = null;
      return null;
    }

    // Include inputColorSpace in cache key — linearization changes the encode input
    const key = `${this.format}:${this.quality}:${input.width}x${input.height}:cs${this.inputColorSpace}`;
    if (key === this.lastEncodeKey && this.encodeResult) {
      return this.encodeResult;
    }

    // Wait for any in-flight encode to finish before starting a new one.
    // This prevents returning stale results when format/quality changed mid-encode.
    if (this.pendingEncode) {
      await this.pendingEncode;
      // Re-check cache — the completed encode may have produced our result
      if (key === this.lastEncodeKey && this.encodeResult) {
        return this.encodeResult;
      }
    }

    // BC6H + sRGB: linearize before encoding
    let encodeInput = input;
    if (this.needsLinearize()) {
      encodeInput = this.linearize(input);
    } else {
      // Clear stale linearized source when not needed
      this.linearizedSource?.destroy();
      this.linearizedSource = null;
    }

    this.pendingEncode = this.encoder.encode(encodeInput, this.format, this.quality);

    try {
      this.encodeResult = await this.pendingEncode;
      this.lastEncodeKey = key;
      return this.encodeResult;
    } catch (err) {
      console.error(`[BCCompressStage] Encode failed for ${this.format}/${this.quality}:`, err);
      this.encodeResult = null;
      return null;
    } finally {
      this.pendingEncode = null;
    }
  }

  /** Invalidate the encode cache, forcing re-encode on next runEncode(). */
  invalidateCache(): void {
    this.lastEncodeKey = '';
  }

  destroy(): void {
    this.encoder?.destroy();
    this.linearizedSource?.destroy();
    this.linearizedSource = null;
    this.encodeResult = null;
    this.output = null;
  }
}
