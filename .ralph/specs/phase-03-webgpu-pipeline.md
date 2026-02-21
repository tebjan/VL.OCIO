# Phase 3: WebGPU Render Pipeline

> **Deep-dive reference**: `specs-pipeline-checker/sections/section-03-webgpu-renderer.md` (~1008 lines)
> Contains complete class skeletons (PipelineStage, FragmentStage, PipelineRenderer), the full uniform buffer layout (232 bytes with exact byte offsets), serializeUniforms() function, stage chaining pattern, and texture upload utility. **Read it for the complete uniform byte layout.**

**Goal**: A working multi-pass WebGPU renderer that chains texture stages.

## Checklist

- [x] 3.1 PipelineStage interface
- [x] 3.2 FragmentStage implementation
- [x] 3.3 PipelineRenderer orchestrator
- [x] 3.4 Render target management
- [ ] 3.5 Uniform buffer layout
- [ ] 3.6 Pixel readback utility
- [ ] 3.7 Verify: `npm run build` passes

## Task 3.1: PipelineStage interface

Create `src/pipeline/PipelineStage.ts`:

```typescript
export interface PipelineStage {
  readonly name: string;
  readonly index: number;
  enabled: boolean;
  output: GPUTexture | null;

  initialize(device: GPUDevice, width: number, height: number): void;
  resize(width: number, height: number): void;
  encode(encoder: GPUCommandEncoder, input: GPUTexture, uniforms: PipelineUniforms): void;
  destroy(): void;
}
```

Each stage owns a `GPUTexture` render target, a pipeline, and a bind group per frame.

## Task 3.2: FragmentStage implementation

Create `src/pipeline/FragmentStage.ts`:

1. Creates `GPURenderPipeline` from a WGSL module string
2. `GPUBindGroupLayout`: texture, sampler, uniform buffer
3. On `encode()`: render pass targeting its own render target, draw 3 vertices (fullscreen triangle)
4. Output to `rgba32float`

**Fullscreen triangle vertex shader** (standard approach):

```wgsl
@vertex
fn vs(@builtin(vertex_index) i: u32) -> VertexOutput {
    var out: VertexOutput;
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(uv.x, 1.0 - uv.y);
    return out;
}
```

**CRITICAL — No blending on float32 targets**:

```typescript
fragment: {
  targets: [{
    format: 'rgba32float',
    blend: undefined,  // REQUIRED — no hardware blending on float32
  }],
}
```

**CRITICAL — Bind group for rgba32float textures**:

```typescript
const bindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'unfilterable-float' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT,
      sampler: { type: 'non-filtering' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' } }
  ]
});
```

## Task 3.3: PipelineRenderer orchestrator

Create `src/pipeline/PipelineRenderer.ts`:

```typescript
export class PipelineRenderer {
  private stages: PipelineStage[];

  render(sourceTexture: GPUTexture, settings: PipelineSettings): void {
    const encoder = this.device.createCommandEncoder();
    let currentInput = sourceTexture;

    for (const stage of this.stages) {
      if (stage.enabled) {
        stage.encode(encoder, currentInput, settings);
        currentInput = stage.output!;
      }
    }

    this.device.queue.submit([encoder.finish()]);
  }

  getStageOutput(index: number): GPUTexture | null {
    // Returns effective output (own if enabled, last enabled before it otherwise)
  }
}
```

## Task 3.4: Render target management

Each stage creates its render target on `initialize()`:

```typescript
device.createTexture({
  size: [width, height],
  format: 'rgba32float',
  usage: GPUTextureUsage.RENDER_ATTACHMENT
       | GPUTextureUsage.TEXTURE_BINDING
       | GPUTextureUsage.COPY_SRC,
  label: `Stage ${this.index}: ${this.name}`
});
```

**`rgba32float` is essential** — `rgba16float` loses precision for HDR and ACES spline calculations.

**bytesPerRow alignment**: All readback requires 256-byte alignment:

```typescript
const bytesPerPixel = 16; // rgba32float
const alignedBytesPerRow = Math.ceil(width * bytesPerPixel / 256) * 256;
```

## Task 3.5: Uniform buffer layout

Create `src/pipeline/PipelineUniforms.ts`:

Single shared uniform buffer (~240 bytes). See `spec.md` for full PipelineSettings interface.

**WGSL struct alignment**: vec3 fields need 16-byte alignment with `_pad: f32`:

```wgsl
struct PipelineUniforms {
    inputSpace: i32,
    gradingSpace: i32,
    gradeExposure: f32,
    contrast: f32,
    // ... scalars ...
    _pad0: f32, _pad1: f32,  // align to 16 bytes
    lift: vec3<f32>, _padLift: f32,
    gamma: vec3<f32>, _padGamma: f32,
    // ... etc
};
```

TypeScript side must match this layout exactly when writing Float32Array/Int32Array.

## Task 3.6: Pixel readback utility

Create `src/pipeline/PixelReadback.ts`:

```typescript
export class PixelReadback {
  async readPixel(texture: GPUTexture, x: number, y: number): Promise<Float32Array | null> {
    if (this.pending) return null;  // Skip if previous read still in flight
    this.pending = true;

    const bytesPerRow = 256;  // Minimum alignment
    const buffer = this.device.createBuffer({
      size: bytesPerRow,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture, origin: { x, y, z: 0 } },
      { buffer, bytesPerRow },
      { width: 1, height: 1 }
    );
    this.device.queue.submit([encoder.finish()]);

    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(buffer.getMappedRange().slice(0, 16));
    buffer.unmap();
    buffer.destroy();

    this.pending = false;
    return data;  // [R, G, B, A]
  }
}
```

Throttle to max ~30 Hz via `requestAnimationFrame`.
