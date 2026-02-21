import type { PipelineStage } from './PipelineStage';

/**
 * Fullscreen triangle vertex shader, prepended to every stage's fragment WGSL.
 * Generates positions and UVs procedurally from vertex_index — no vertex buffer needed.
 * Draws a single oversized triangle that covers clip space [-1,1] after clipping.
 */
const FULLSCREEN_TRIANGLE_VERTEX_WGSL = /* wgsl */`
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VertexOutput {
    var out: VertexOutput;
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(uv.x, 1.0 - uv.y);
    return out;
}
`;

/**
 * A concrete base class implementing PipelineStage for any stage that runs
 * a fragment shader over a fullscreen triangle. Stages 3-9 use this class,
 * providing only a WGSL fragment shader string.
 *
 * The vertex shader is prepended automatically. The bind group layout is:
 *   binding 0: input texture (unfilterable-float)
 *   binding 1: sampler (non-filtering / nearest)
 *   binding 2: uniform buffer (PipelineUniforms)
 */
export class FragmentStage implements PipelineStage {
  readonly name: string;
  readonly index: number;
  enabled: boolean = true;
  output: GPUTexture | null = null;

  private device!: GPUDevice;
  private pipeline: GPURenderPipeline | null = null;
  private bindGroupLayout!: GPUBindGroupLayout;
  private sampler!: GPUSampler;
  private shaderCode: string;

  constructor(name: string, index: number, fragmentWGSL: string) {
    this.name = name;
    this.index = index;
    this.shaderCode = fragmentWGSL;
  }

  initialize(device: GPUDevice, width: number, height: number): void {
    this.device = device;

    // Nearest-neighbor sampler — no interpolation, exact pixel values
    this.sampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Bind group layout shared by all fragment stages
    this.bindGroupLayout = device.createBindGroupLayout({
      label: `Stage ${this.index} bind group layout`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'non-filtering' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Combine vertex + fragment WGSL into a single module
    const combinedWGSL = FULLSCREEN_TRIANGLE_VERTEX_WGSL + '\n' + this.shaderCode;
    const shaderModule = device.createShaderModule({
      label: `Stage ${this.index}: ${this.name}`,
      code: combinedWGSL,
    });

    this.pipeline = this.createRenderPipeline(device, shaderModule, this.bindGroupLayout);
    this.output = this.createRenderTarget(device, width, height);
  }

  resize(width: number, height: number): void {
    this.output?.destroy();
    this.output = this.createRenderTarget(this.device, width, height);
  }

  encode(encoder: GPUCommandEncoder, input: GPUTexture, uniforms: GPUBuffer): void {
    if (!this.output || !this.pipeline) return;

    // Create bind group with current input texture
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: uniforms } },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.output.createView(),
        loadOp: 'clear' as GPULoadOp,
        storeOp: 'store' as GPUStoreOp,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3); // Fullscreen triangle — 3 vertices, no vertex buffer
    pass.end();
  }

  destroy(): void {
    this.output?.destroy();
    this.output = null;
    // GPURenderPipeline and GPUBindGroupLayout do not need explicit destruction
  }

  private createRenderTarget(device: GPUDevice, width: number, height: number): GPUTexture {
    return device.createTexture({
      size: [width, height],
      format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
           | GPUTextureUsage.TEXTURE_BINDING
           | GPUTextureUsage.COPY_SRC,
      label: `Stage ${this.index}: ${this.name}`,
    });
  }

  private createRenderPipeline(
    device: GPUDevice,
    shaderModule: GPUShaderModule,
    bindGroupLayout: GPUBindGroupLayout
  ): GPURenderPipeline {
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    return device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [{
          format: 'rgba32float',
          blend: undefined, // REQUIRED — no hardware blending on float32
        }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
  }
}
