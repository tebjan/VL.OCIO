# Phase 6: BC Pipeline Stages

> **Deep-dive reference**: `specs-pipeline-checker/sections/section-06-bc-pipeline-stages.md` (~728 lines)
> Contains complete BCCompressStage and BCDecompressStage TypeScript classes, BC decompress WGSL shader code, software fallback strategy, inter-stage data flow pattern, delta overlay shader (WGSL), and enable/disable behavior for all 4 BC combinations.

**Goal**: Stages 2 (compress) and 3 (decompress) integrated into the pipeline.

## Checklist

- [x] 6.1 BCCompressStage — compute stage
- [x] 6.2 BCDecompressStage — hardware decode
- [x] 6.3 BC metrics display in stage card
- [x] 6.4 Delta overlay (heat map)
- [ ] 6.5 Graceful fallback when BC unavailable
- [ ] 6.6 Verify: `npm run build` passes

## Task 6.1: Stage 2 — BC Compress

Create `src/pipeline/stages/BCCompressStage.ts`:

This is a **compute stage** (not fragment):

1. Reads from input texture (Stage 1 output / EXR data)
2. Dispatches BC encoder compute shader
3. Outputs `Uint8Array` of BC block data (in `GPUBuffer`)
4. "Output texture" for filmstrip = original input (BC data not directly displayable)

**Stage card label**: Show "GPU Real-time Encoding" badge. Tooltip: "Encoding quality may differ from offline CPU encoders (NVTT, DirectXTex)."

## Task 6.2: Stage 3 — BC Decompress

Create `src/pipeline/stages/BCDecompressStage.ts`:

Uses WebGPU native `texture-compression-bc`:

```typescript
const bcTexture = device.createTexture({
  size: [width, height],
  format: bcFormatToGPU(format),  // e.g., 'bc6h-rgb-ufloat'
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
});

device.queue.writeTexture(
  { texture: bcTexture },
  blockData,
  { bytesPerRow: blocksPerRow * blockSize },
  { width, height }
);
```

Then fullscreen quad sampling from `bcTexture` → `rgba32float` render target. GPU hardware decompresses automatically.

**BC format → GPUTextureFormat mapping**:

| BC | GPUTextureFormat |
|----|-----------------|
| bc1 | `bc1-rgba-unorm` |
| bc2 | `bc2-rgba-unorm` |
| bc3 | `bc3-rgba-unorm` |
| bc4 | `bc4-r-unorm` |
| bc5 | `bc5-rg-unorm` |
| bc6h | `bc6h-rgb-ufloat` |
| bc7 | `bc7-rgba-unorm` |

## Task 6.3: BC metrics display

After decompress, run metrics compute shader: original vs decompressed. Show PSNR + max error in Stage 3 card and preview area.

## Task 6.4: Delta overlay

"Delta View" toggle: render `abs(original - decompressed) * 10.0` as heat map on Stage 3 output.

## Task 6.5: Fallback

If `texture-compression-bc` feature unavailable:

- Show warning message
- Skip stages 2 + 3 (pass EXR directly to stage 4)
- Pipeline still works without BC
