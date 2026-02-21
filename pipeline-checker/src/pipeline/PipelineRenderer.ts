import type { PipelineStage } from './PipelineStage';

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

    this.device.queue.submit([encoder.finish()]);
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
