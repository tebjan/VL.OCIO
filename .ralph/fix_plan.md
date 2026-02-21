# Implementation Plan — Pipeline Checker

Reference: `.ralph/specs/spec.md` (source of truth), phase files in `.ralph/specs/phase-*.md` (per-phase detail)

Each phase file references a detailed section file in `specs-pipeline-checker/sections/` — read it when the phase file lacks implementation details.

---

## Wave 1: Foundation (no dependencies)

### Phase 1: Project Scaffolding
- [x] 1.1 Initialize Vite + React 19 + TypeScript + Tailwind 4 project in `pipeline-checker/`
- [x] 1.2 Create `src/gpu/WebGPUContext.ts` — adapter, device, BC feature request, canvas config
- [x] 1.3 Create `src/components/DropZone.tsx` — drag-drop EXR + "Try sample" button
- [x] 1.4 Dark theme setup — backgrounds #0d0d0d/#1a1a1a, no saturated accents
- [x] 1.5 Verify: `npm install && npm run build && npx tsc --noEmit` all pass

---

## Wave 2: Core Infrastructure (requires Wave 1)

> Phases 3 and 5 can be done in any order within this wave.

### Phase 3: WebGPU Render Pipeline
- [x] 3.1 `PipelineStage` interface (initialize/resize/encode/destroy)
- [x] 3.2 `FragmentStage` — GPURenderPipeline from WGSL, fullscreen triangle, rgba32float target
- [x] 3.3 `PipelineRenderer` — chains stages, disabled stages passthrough
- [x] 3.4 Render target management — rgba32float, RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC
- [x] 3.5 `PipelineUniforms` — shared uniform buffer (~240 bytes), all stage params
- [x] 3.6 `PixelReadback` — single pixel read from any stage texture, 30Hz throttle
- [x] 3.7 Verify: `npm run build` passes

### Phase 5: BC Encoder Package
- [x] 5.1 Scaffold `packages/webgpu-bc-encoder/` with TypeScript
- [x] 5.2 Port WGSL compute shaders from block_compression repo (BC1-7)
- [x] 5.3 BCEncoder class — encode(texture, format, quality) → BCEncodeResult
- [x] 5.4 BC metrics compute shader — PSNR per channel + max error
- [x] 5.5 Verify: package builds, BC6H encodes test texture

---

## Wave 3: Pipeline Content (requires Wave 2)

> **DEPENDENCY**: Phase 4 requires Phase 3 (renderer). Phase 6 requires Phases 3 + 5. Phase 7 requires Phase 3.
> Do NOT start Phase 4 until Phase 3 is complete.
> Phases 4, 6, and 7 can be done in any order within this wave (after their dependencies).

### Phase 4: Color Pipeline WGSL Shaders (manual port from SDSL)
- [x] 4.1 `input-convert.wgsl` — Stage 4: ToLinearRec709(), 6 gamut matrices (TRANSPOSED), 10 transfer functions
- [x] 4.2 `color-grade.wgsl` — Stage 5: DecodeInput, ApplyGradingLog, ApplyGradingLinear, 22 uniforms
- [x] 4.3 `rrt.wgsl` — Stage 6: all 12 tonemap operators, ACES 1.3/2.0 RRT, spline arrays
- [x] 4.4 `odt.wgsl` — Stage 7: ACES 1.3/2.0 ODT, gamut conversion
- [x] 4.5 `output-encode.wgsl` — Stage 8: FromLinearRec709, PQ, HLG, scRGB encoding
- [x] 4.6 `display-remap.wgsl` — Stage 9: black/white level remap (trivial)
- [x] 4.7 `fullscreen-quad.wgsl` — shared vertex shader
- [x] 4.8 Wire all stages into PipelineRenderer
- [x] 4.9 Verify: `npm run build` + visual test with sample EXR

### Phase 6: BC Pipeline Stages
- [x] 6.1 `BCCompressStage` — compute stage dispatching encoder
- [x] 6.2 `BCDecompressStage` — upload BC blocks, hardware decode via texture-compression-bc
- [x] 6.3 BC metrics display in stage card
- [x] 6.4 Delta overlay (abs difference × 10 as heat map)
- [x] 6.5 Graceful fallback when texture-compression-bc unavailable
- [x] 6.6 Verify: `npm run build` passes

### Phase 7: UI — Filmstrip + Controls
- [x] 7.1 `Filmstrip.tsx` — horizontal scrollable, arrow connectors, stage cards
- [x] 7.2 `StageCard.tsx` — 160x90 thumbnail, name, enable/disable checkbox
- [x] 7.3 `ControlsPanel.tsx` — collapsible sections: Input, Grading, Tonemap, Output
- [x] 7.4 Reusable `Slider.tsx`, `Select.tsx`, `Section.tsx` (match VL.OCIO web UI style)
- [x] 7.5 `types/settings.ts` — all enums, labels, defaults (mirror C# exactly)
- [x] 7.6 Reset button, `usePipeline` hook
- [x] 7.7 Verify: `npm run build` passes, all controls render

---

## Wave 4: Integration (requires Wave 3)

> **DEPENDENCY**: Phase 8 requires Phases 4 + 6 + 7.

### Phase 8: Preview + Readout
- [x] 8.1 `Preview2D.tsx` — zoom (wheel), pan (drag), fit (double-click), view exposure
- [x] 8.2 `PixelReadout.tsx` — floating tooltip RGBA 5-decimal, 30Hz throttle
- [x] 8.3 `MetadataPanel.tsx` — resolution, channels, min/max per channel
- [x] 8.4 "View (non-destructive)" section clearly separated from pipeline controls
- [x] 8.5 Verify: `npm run build` passes

---

## Wave 5: 3D Visualization (requires Wave 3)

> **DEPENDENCY**: Phase 9 requires Phase 4 (needs stage output textures).

### Phase 9: 3D Heightmap
- [x] 9.1 Three.js WebGPU renderer + OrbitControls in `HeightmapView.tsx`
- [x] 9.2 TSL compute shader — reads stage texture, writes instancedArray buffers (no CPU readback)
- [x] 9.3 SpriteNodeMaterial billboards — positionNode + colorNode from storage buffers
- [x] 9.4 7 height modes (luminance, R, G, B, max, RGB length, AP1 luma) all GPU-side
- [x] 9.5 Height scale, exponent, range, downsample controls
- [x] 9.6 Wireframe bounding box + camera shortcuts (F = frame, dblclick = reset)
- [x] 9.7 `MainPreview.tsx` — [2D] / [3D] tab toggle
- [ ] 9.8 Verify: `npm run build` passes

---

## Wave 6: Final (requires all)

### Phase 10: Build & Distribution
- [ ] 10.1 vite-plugin-singlefile config, WGSL ?raw imports, inlineDynamicImports
- [ ] 10.2 Verify: `dist/index.html` opens via file://, WebGPU inits, sample EXR loads
- [ ] 10.3 Verify: file size < 10 MB

### Phase 11: Test Verification
- [ ] 11.1 Create `test/fixtures/reference-values.json` with known pixel test points
- [ ] 11.2 Create `test/verify.py` — per-stage math verification, exit code 0/1
- [ ] 11.3 Verify: `python test/verify.py` passes for all implemented stages

---

## Completed
- [x] Project planning and spec creation

---

## Dependency Rules

- **Phase 4 requires Phase 3.** Do NOT start WGSL shader porting until the WebGPU renderer infrastructure is working.
- **Phase 6 requires Phases 3 + 5.** BC pipeline stages need both the renderer and the encoder package.
- **Phase 7 only requires Phase 3.** Filmstrip UI can use placeholder thumbnails before color stages exist.
- **Phase 8 requires Phases 4 + 6 + 7.** Preview needs real stage textures, BC outputs, and filmstrip selection state.
- **Phase 9 requires Phase 4.** 3D heightmap needs working stage output textures.
- **Phases 10-11 require all.** Final build + verification is the last step.
- **BC stages (5, 6) are optional.** If `texture-compression-bc` feature is unavailable, skip BC stages — the pipeline works without them by passing EXR data directly to Stage 4. Don't block progress on BC.

## Notes

- ONE task per loop iteration. Focus on the first unchecked item in the earliest incomplete wave.
- Before implementing any WGSL shader: read the MUST READ reference in `phase-04-color-shaders.md` — it points to the section file with exact algorithm constants.
- Read the SDSL source shaders at `shaders/` for reference when porting to WGSL.
- ALL matrices must be transposed (SDSL row-major -> WGSL column-major).
- vec3 uniforms need `_pad: f32` for 16-byte alignment.
- Never use `fetch()` for shaders — use `?raw` imports.
- After EVERY implementation: run `npm run build` to catch regressions.
- Do NOT change the public API of a completed phase without re-verifying all dependent phases.
- Each section file in `specs-pipeline-checker/sections/` has formal acceptance criteria — verify them when finishing a phase.
