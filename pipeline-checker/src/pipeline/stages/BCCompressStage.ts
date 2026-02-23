import type { PipelineStage } from '../PipelineStage';
import { BCEncoder, type BCFormat, type BCQuality, type BCEncodeResult } from '@vl-ocio/webgpu-bc-encoder';

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
 */
export class BCCompressStage implements PipelineStage {
  readonly name = 'BC Compress';
  readonly index = 1;
  enabled: boolean;
  available: boolean;
  output: GPUTexture | null = null;

  /** Cached encode result for BCDecompressStage to consume. */
  encodeResult: BCEncodeResult | null = null;

  private encoder: BCEncoder | null;
  private format: BCFormat = 'bc6h';
  private quality: BCQuality = 'normal';

  /** Track last encode parameters to avoid redundant encodes. */
  private lastEncodeKey = '';
  private pendingEncode: Promise<BCEncodeResult> | null = null;

  constructor(device: GPUDevice, hasBC: boolean) {
    this.available = hasBC;
    this.enabled = hasBC;
    this.encoder = hasBC ? new BCEncoder(device) : null;
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
   */
  async runEncode(input: GPUTexture): Promise<BCEncodeResult | null> {
    if (!this.enabled || !this.encoder) {
      this.encodeResult = null;
      return null;
    }

    const key = `${this.format}:${this.quality}:${input.width}x${input.height}`;
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

    this.pendingEncode = this.encoder.encode(input, this.format, this.quality);

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
    this.encodeResult = null;
    this.output = null;
  }
}
