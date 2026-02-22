import type { PipelineStage } from './PipelineStage';
import { encodeMipmaps } from './TextureUtils';

/**
 * Orchestrates multi-pass rendering through the color pipeline.
 *
 * Owns the stage array, drives the per-frame render loop, and manages
 * stage chaining logic. All stages execute within a single command buffer
 * submission — WebGPU guarantees render target writes from one pass are
 * visible to texture reads in subsequent passes within the same submission.
 */
export class PipelineRenderer {
  private device: GPUDevice;
  private stages: PipelineStage[] = [];
  private uniformBuffer: GPUBuffer;
  private width: number = 0;
  private height: number = 0;
  private hasLoggedFirstRender: boolean = false;

  constructor(device: GPUDevice) {
    this.device = device;

    // Uniform buffer created once, updated per frame when settings change.
    // 512 bytes accommodates all pipeline uniforms with alignment padding.
    this.uniformBuffer = device.createBuffer({
      size: 512,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'Pipeline Uniforms',
    });
  }

  /** Register all stages. Called once during app initialization. */
  setStages(stages: PipelineStage[]): void {
    this.stages = stages;
  }

  /**
   * Initialize or resize all stages to match EXR dimensions.
   * First call initializes stages; subsequent calls resize them.
   */
  setSize(width: number, height: number): void {
    const isFirstInit = this.width === 0;
    this.width = width;
    this.height = height;

    for (const stage of this.stages) {
      if (isFirstInit) {
        stage.initialize(this.device, width, height);
      } else {
        stage.resize(width, height);
      }
    }
  }

  /**
   * Write updated uniform data to the GPU uniform buffer.
   * Called when pipeline settings change (not every frame).
   * @param data - Serialized uniform data (ArrayBuffer or TypedArray).
   */
  updateUniforms(data: Float32Array<ArrayBuffer>): void {
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  /** Get the shared uniform buffer for external use (e.g. pixel readback). */
  getUniformBuffer(): GPUBuffer {
    return this.uniformBuffer;
  }

  /**
   * Render all enabled stages in a single command buffer submission.
   *
   * Disabled stages are bypassed: the next enabled stage receives the
   * last enabled stage's output as input. This is transparent to
   * individual stages — they always receive an input and produce output.
   *
   * @param sourceTexture - The EXR source texture (stage 0/1 output).
   */
  render(sourceTexture: GPUTexture): void {
    // Use error scope on first render to catch validation issues
    const isFirst = !this.hasLoggedFirstRender;
    if (isFirst) {
      this.device.pushErrorScope('validation');
    }

    const encoder = this.device.createCommandEncoder();
    let currentInput = sourceTexture;

    for (const stage of this.stages) {
      if (stage.enabled) {
        stage.encode(encoder, currentInput, this.uniformBuffer);
        currentInput = stage.output!;
      }
      // When disabled: currentInput is unchanged, so the next enabled
      // stage receives the last enabled stage's output (bypass).
    }

    // Generate mipmaps for each enabled stage's output (for preview/thumbnail display).
    // Stage shaders use textureLoad (mip 0 only), so mipmaps don't affect inter-stage rendering.
    for (const stage of this.stages) {
      if (stage.enabled && stage.output) {
        encodeMipmaps(this.device, encoder, stage.output);
      }
    }

    this.device.queue.submit([encoder.finish()]);

    // Log first successful render with stage info
    if (isFirst) {
      this.hasLoggedFirstRender = true;
      const enabledCount = this.stages.filter(s => s.enabled).length;
      console.log(`[Pipeline] Rendered ${enabledCount}/${this.stages.length} enabled stages (${this.width}x${this.height})`);

      // Check for validation errors during first render
      this.device.popErrorScope().then((error) => {
        if (error) {
          console.error(
            `%c[Pipeline] RENDER VALIDATION ERROR: ${error.message}`,
            'color: red; font-weight: bold; font-size: 14px;',
          );
        } else {
          console.log('[Pipeline] First render: no validation errors');
        }
      });

      // One-time diagnostic: read back center pixel from each stage output
      this.readbackDiagnostic(sourceTexture);
    }
  }

  /**
   * One-time diagnostic: read back the center pixel from each stage's output
   * to verify non-zero values and correct stage-to-stage chaining.
   * Runs asynchronously after the first render.
   */
  private async readbackDiagnostic(sourceTexture: GPUTexture): Promise<void> {
    const cx = Math.floor(this.width / 2);
    const cy = Math.floor(this.height / 2);

    // Read source texture center pixel
    const srcPixel = await this.readPixel(sourceTexture, cx, cy);
    console.log(`[Pipeline Diagnostic] Source pixel (${cx},${cy}): [${Array.from(srcPixel).map(v => v.toFixed(4)).join(', ')}]`);

    // Read each stage output
    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i];
      if (stage.output && stage.enabled) {
        const pixel = await this.readPixel(stage.output, cx, cy);
        console.log(`[Pipeline Diagnostic] Stage ${i} (${stage.name}): [${Array.from(pixel).map(v => v.toFixed(4)).join(', ')}]`);
      } else if (!stage.enabled) {
        console.log(`[Pipeline Diagnostic] Stage ${i} (${stage.name}): DISABLED (bypassed)`);
      }
    }
  }

  /**
   * Read a single pixel from a GPUTexture at (x, y).
   * Uses copyTextureToBuffer + mapAsync for GPU readback.
   */
  private async readPixel(texture: GPUTexture, x: number, y: number): Promise<Float32Array> {
    const isFloat16 = texture.format === 'rgba16float';
    const bytesPerPixel = isFloat16 ? 8 : 16;
    const bytesPerRow = 256;  // minimum 256-byte alignment for copyTextureToBuffer

    const stagingBuffer = this.device.createBuffer({
      size: bytesPerRow,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture, origin: { x, y } },
      { buffer: stagingBuffer, bytesPerRow },
      { width: 1, height: 1 }
    );
    this.device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const pixel = new Float32Array(4);
    if (isFloat16) {
      const dv = new DataView(stagingBuffer.getMappedRange(0, bytesPerPixel));
      for (let i = 0; i < 4; i++) pixel[i] = dv.getFloat16(i * 2, true);
    } else {
      const data = new Float32Array(stagingBuffer.getMappedRange(0, bytesPerPixel));
      pixel.set(data);
    }
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return pixel;
  }

  /**
   * Get the effective output texture for a given stage index.
   * If the stage is enabled, returns its own output.
   * If disabled, returns the output of the last enabled stage before it.
   * Used by filmstrip thumbnails and the preview renderer.
   */
  getStageOutput(index: number): GPUTexture | null {
    for (let i = index; i >= 0; i--) {
      if (this.stages[i]?.enabled && this.stages[i].output) {
        return this.stages[i].output;
      }
    }
    return null;
  }

  /** Get the stage array for UI display (read-only). */
  getStages(): ReadonlyArray<PipelineStage> {
    return this.stages;
  }

  /** Get current pipeline dimensions. */
  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Clean up all GPU resources. */
  destroy(): void {
    for (const stage of this.stages) {
      stage.destroy();
    }
    this.uniformBuffer.destroy();
  }
}
