# Phase 5: BC Encoder Package

> **Deep-dive reference**: `specs-pipeline-checker/sections/section-05-bc-encoder-package.md` (~737 lines)
> Contains source acquisition strategy (DirectXTex primary, block_compression supplementary, Betsy BC6H), HLSL->WGSL compute shader conversion patterns, workgroup size per format table, storage buffer layout, BC6H mode structure and quality modes, and complete TypeScript interfaces.

**Goal**: A standalone package providing GPU-based BC1-7 encoding via WebGPU compute shaders.

## Checklist

- [x] 5.1 Package scaffolding
- [x] 5.2 Port WGSL compute shaders from block_compression repo
- [x] 5.3 BCEncoder class with public API
- [ ] 5.4 BC metrics compute shader (PSNR + max error)
- [ ] 5.5 Verify: package builds, BC6H encodes test texture

## Task 5.1: Package scaffolding

Create `packages/webgpu-bc-encoder/`:

```
packages/webgpu-bc-encoder/
  package.json           # name: "@vl-ocio/webgpu-bc-encoder"
  tsconfig.json
  src/
    index.ts             # Public API
    encoder.ts           # Core encoder class
    formats/bc1.ts through bc7.ts
    shaders/bc1-compress.wgsl through bc7-compress.wgsl
    metrics.ts           # PSNR/error computation
```

## Task 5.2: Source acquisition

**Primary source**: [block_compression](https://github.com/niclaslindstedt/block_compression) — Rust/WGSL project with all BC formats in native WGSL compute shaders.

**Adaptation needed**:

1. Adjust bind group layouts for our pipeline
2. Input from `texture_2d<f32>` (if they use storage buffers)
3. Output to `storage` buffer

**Compute shader pattern** (each format):

```wgsl
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBlocks: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params { width: u32, height: u32, quality: u32 };

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let blockX = gid.x;
    let blockY = gid.y;
    // Load 4x4 pixel block, encode, write to output buffer
}
```

**Dispatch**: `ceil(width/4) * ceil(height/4)` workgroups.

## BC format specifics

| Format | Block Bytes | Alpha | Notes |
|--------|-------------|-------|-------|
| BC1 | 8 | 1-bit | 2-color endpoints + 2-bit indices, PCA |
| BC2 | 16 | 4-bit explicit | BC1 color + explicit alpha |
| BC3 | 16 | Interpolated | BC1 color + BC4-style alpha |
| BC4 | 8 | N/A | Single channel |
| BC5 | 16 | N/A | Two independent BC4 blocks (RG) |
| BC6H | 16 | **None** | HDR RGB, half-float, 14 modes. **RGB-only — no alpha.** |
| BC7 | 16 | Full 8-bit | 8 modes, high quality RGBA |

**Alpha handling**: Stages 4-9 pass alpha through unchanged. BC6H discards alpha — show warning: "Alpha not preserved in BC6H. Use BC7 for RGBA."

**BC6H is critical** for this project (HDR EXR data). Quality modes: fast (mode 11 only), normal (top partition candidates), high (exhaustive).

**4x4 padding**: Non-multiple-of-4 images get padded. Store original + padded dimensions in result.

## Task 5.3: Public API

```typescript
export type BCFormat = 'bc1' | 'bc2' | 'bc3' | 'bc4' | 'bc5' | 'bc6h' | 'bc7';
export type BCQuality = 'fast' | 'normal' | 'high';

export interface BCEncodeResult {
  data: Uint8Array;
  format: BCFormat;
  width: number;             // Padded to multiple of 4
  height: number;
  originalWidth: number;
  originalHeight: number;
  blocksPerRow: number;
  blockSize: number;         // 8 for BC1/BC4, 16 for others
  compressionTimeMs: number;
}

export class BCEncoder {
  constructor(device: GPUDevice);
  async encode(source: GPUTexture, format: BCFormat, quality: BCQuality): Promise<BCEncodeResult>;
  destroy(): void;
}
```

## Task 5.4: Quality metrics compute shader

Create `src/shaders/bc-metrics.wgsl`:

Compare original vs decompressed textures:

- Per-pixel: `abs(original - decompressed)` → reduction for max error
- Per-channel: sum of squared errors → PSNR = `10 * log10(1.0 / MSE)`
- Output: `[PSNR_R, PSNR_G, PSNR_B, PSNR_combined, maxError_R, maxError_G, maxError_B, maxError_combined]`
