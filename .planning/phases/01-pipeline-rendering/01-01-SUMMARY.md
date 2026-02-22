---
phase: 01-pipeline-rendering
plan: 01
subsystem: rendering
tags: [webgpu, wgsl, textureLoad, pipeline, gpu-shaders, rgba32float]

# Dependency graph
requires: []
provides:
  - Working GPU rendering pipeline with all 6 fragment stages executing without validation errors
  - textureLoad-based texture sampling for unfilterable-float rgba32float textures
  - Diagnostic pixel readback for verifying stage-to-stage data flow
affects: [01-02, 03-01, 03-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - textureLoad with integer coords for unfilterable-float textures
    - GPU error scope capture around render calls
    - One-time diagnostic pixel readback for pipeline verification

key-files:
  created: []
  modified:
    - pipeline-checker/src/pipeline/FragmentStage.ts
    - pipeline-checker/src/pipeline/PipelineRenderer.ts
    - pipeline-checker/src/components/Preview2D.tsx
    - pipeline-checker/src/components/MainPreview.tsx
    - pipeline-checker/src/App.tsx
    - pipeline-checker/src/shaders/generated/input-convert.wgsl
    - pipeline-checker/src/shaders/generated/color-grade.wgsl
    - pipeline-checker/src/shaders/generated/rrt.wgsl
    - pipeline-checker/src/shaders/generated/odt.wgsl
    - pipeline-checker/src/shaders/generated/output-encode.wgsl
    - pipeline-checker/src/shaders/generated/display-remap.wgsl
    - pipeline-checker/src/shaders/generated/preview-blit.wgsl

key-decisions:
  - "Use textureLoad instead of textureSample for all pipeline stage shaders because rgba32float is unfilterable-float in WebGPU"
  - "Remove sampler from bind group layout entirely (2 bindings: texture + uniforms instead of 3)"
  - "Keep one-time diagnostic readback in PipelineRenderer for runtime verification"

patterns-established:
  - "textureLoad pattern: compute integer coords from UV via vec2<i32>(in.uv * vec2<f32>(textureDimensions(tex)))"
  - "GPU error scope capture: push validation + out-of-memory before render, pop after"

requirements-completed: [PIPE-01, PIPE-02, PIPE-03]

# Metrics
duration: 7min
completed: 2026-02-22
---

# Phase 1 Plan 1: Pipeline Rendering Fix Summary

**Switched all 6 GPU pipeline shaders from textureSample to textureLoad, fixing WebGPU validation failures caused by unfilterable-float rgba32float textures**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-22T00:10:34Z
- **Completed:** 2026-02-22T00:17:37Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Identified root cause: `textureSample()` with `unfilterable-float` texture + `non-filtering` sampler is invalid per WebGPU spec -- causes silent validation failure producing black output
- Converted all 6 pipeline stage shaders and the preview-blit shader from `textureSample` to `textureLoad` with explicit integer coordinate computation
- Simplified bind group layout from 3 entries (texture, sampler, uniforms) to 2 entries (texture, uniforms)
- Added GPU error scope capture in the render loop and shader compilation info logging
- Added one-time diagnostic pixel readback that verifies each stage produces non-zero data after first render

## Task Commits

Each task was committed atomically:

1. **Task 1: Diagnose and fix pipeline rendering failures** - `0026246` (fix)
2. **Task 2: Verify stage-to-stage chaining and enable/disable bypass** - `b8545e3` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `pipeline-checker/src/pipeline/FragmentStage.ts` - Removed sampler from bind group layout, added shader compilation logging
- `pipeline-checker/src/pipeline/PipelineRenderer.ts` - Added one-time diagnostic pixel readback for stage verification
- `pipeline-checker/src/components/Preview2D.tsx` - Removed sampler from bind group, updated binding indices
- `pipeline-checker/src/components/MainPreview.tsx` - Pass renderVersion prop through to Preview2D
- `pipeline-checker/src/App.tsx` - Added GPU error scope capture around pipeline render calls
- `pipeline-checker/src/shaders/generated/input-convert.wgsl` - textureLoad + binding renumber
- `pipeline-checker/src/shaders/generated/color-grade.wgsl` - textureLoad + binding renumber
- `pipeline-checker/src/shaders/generated/rrt.wgsl` - textureLoad + binding renumber
- `pipeline-checker/src/shaders/generated/odt.wgsl` - textureLoad + binding renumber
- `pipeline-checker/src/shaders/generated/output-encode.wgsl` - textureLoad + binding renumber
- `pipeline-checker/src/shaders/generated/display-remap.wgsl` - textureLoad + binding renumber
- `pipeline-checker/src/shaders/generated/preview-blit.wgsl` - textureLoad + sampler removal + binding renumber

## Decisions Made
- **textureLoad over textureSample:** WebGPU requires `float` sample type + `filtering` sampler for `textureSample()`. Since `rgba32float` is `unfilterable-float` by default and requesting `float32-filterable` is not universally supported, `textureLoad` with integer coordinates is the correct universal approach.
- **Removed sampler entirely:** Since `textureLoad` doesn't use a sampler, the sampler binding was removed from the bind group layout rather than leaving an unused binding. This reduces the bind group from 3 to 2 entries.
- **Keep diagnostic readback:** The one-time pixel readback on first render is retained as it provides runtime verification of stage chaining without performance cost (runs only once).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed preview-blit shader same textureSample issue**
- **Found during:** Task 1 (diagnosing rendering failures)
- **Issue:** The preview-blit.wgsl shader (used by Preview2D for display) also used `textureSample` with `unfilterable-float`, causing the same validation error
- **Fix:** Switched to `textureLoad`, removed sampler binding, updated Preview2D.tsx bind group layout and bind group creation
- **Files modified:** `preview-blit.wgsl`, `Preview2D.tsx`
- **Verification:** Build passes, Preview2D component correctly references new binding layout
- **Committed in:** 0026246 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Essential fix -- preview-blit had the same root cause as pipeline stages. Without fixing it, the preview would also show black even with fixed pipeline stages.

## Issues Encountered
None beyond the diagnosed root cause.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- GPU pipeline stages compile, create valid render pipelines, and execute render passes without validation errors
- Stage-to-stage chaining and bypass logic verified correct in code
- Ready for Plan 01-02: Preview2D display, filmstrip thumbnails, zoom/pan, and stage interaction

## Self-Check: PASSED

- All 12 modified files verified present on disk
- Commit 0026246 (Task 1) verified in git log
- Commit b8545e3 (Task 2) verified in git log
- `npm run build` passes without errors

---
*Phase: 01-pipeline-rendering*
*Completed: 2026-02-22*
