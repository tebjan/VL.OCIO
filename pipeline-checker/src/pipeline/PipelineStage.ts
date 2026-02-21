export interface PipelineStage {
  /** Human-readable stage name (e.g., "Input Interpretation") */
  readonly name: string;

  /** Zero-based stage index (0-9) */
  readonly index: number;

  /** Whether this stage is active. When false, the stage is bypassed. */
  enabled: boolean;

  /** This stage's render target. null before initialize(). */
  output: GPUTexture | null;

  /**
   * Create GPU resources: render target, pipeline, bind group layout.
   * Called once after device is ready, and again on resize.
   */
  initialize(device: GPUDevice, width: number, height: number): void;

  /**
   * Recreate the render target at a new resolution.
   * Destroys the old render target and creates a new one.
   */
  resize(width: number, height: number): void;

  /**
   * Record GPU commands for this stage into the command encoder.
   * @param encoder - The shared command encoder for the current frame.
   * @param input - The previous stage's output texture (or source EXR texture).
   * @param uniforms - Pipeline-wide uniform buffer bound to all stages.
   */
  encode(
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    uniforms: GPUBuffer
  ): void;

  /** Release all GPU resources owned by this stage. */
  destroy(): void;
}
