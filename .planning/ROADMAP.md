# Roadmap: Pipeline Checker Fix & Integration

## Overview

Fix the broken pipeline-checker rendering so all 10 stages produce visible output, replace the duplicated color grading controls with the existing `ui/` project's components, polish usability, and automate SDSL-to-WGSL shader transpilation so the pipeline-checker's shaders are always mathematically identical to the Stride shaders.

## Milestones

- [x] **v1.0 Pipeline Fix & UI Integration** - Phases 1-3 (shipped 2026-02-22)
- [ ] **v1.1 Usability Polish** - Phases 4-6.1 (in progress)
- [ ] **v1.2 Shader Transpiler** - Phases 7-9 (planned)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 Pipeline Fix & UI Integration (Phases 1-3) - SHIPPED 2026-02-22</summary>

- [x] **Phase 1: Pipeline Rendering** - Fix all 10 pipeline stages to render visible output with correct texture chaining, toggles, and previews
- [x] **Phase 2: Grading UI Integration** - Replace duplicated grading controls with the existing `ui/` project's components and styling
- [ ] **Phase 3: GPU Testing Framework** - Build test runner that executes real WebGPU pipeline stages with pixel readback and visual heuristics (deferred)

</details>

- [x] **Phase 4: Interaction Clarity** - Fix click areas, add blue active-stage highlight, show stage name in preview header
- [x] **Phase 5: Display Logic** - Final Display always sRGB, toggle scoping, DDS stage graying
- [x] **Phase 6: Tooltips** - Explanatory tooltips on all pipeline stages and UI controls (completed 2026-02-22)
- [ ] **Phase 6.1: Session Persistence** - INSERTED — Persist dropped image and selected view across page reload
- [ ] **Phase 7: SDSL Stage Shaders** - Create 6 per-stage SDSL TextureFX shaders that compose from existing mixins
- [ ] **Phase 8: Transpiler Tool** - Build .NET console app that converts SDSL to WGSL via Stride compiler, DXC, and Naga
- [ ] **Phase 9: Verification & Integration** - Validate mathematical parity, replace hand-ported WGSL, commit generated output

## Phase Details

<details>
<summary>v1.0 Phase Details (Phases 1-3)</summary>

### Phase 1: Pipeline Rendering
**Goal**: User loads an EXR and sees correct, visible output at every pipeline stage
**Depends on**: Nothing (first phase)
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05
**Success Criteria** (what must be TRUE):
  1. Loading an EXR image produces visible rendered output in every one of the 10 pipeline stages (no black/blank frames)
  2. Each stage visually reflects its transform applied on top of the previous stage's output (texture chaining is correct)
  3. Toggling a stage on/off visibly bypasses that stage's transform in all downstream outputs
  4. The filmstrip shows a distinct, correct thumbnail for each stage, and clicking a stage shows its full output in the 2D preview with working zoom/pan
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md -- Debug and fix GPU pipeline rendering
- [x] 01-02-PLAN.md -- Fix Preview2D display, filmstrip thumbnails, zoom/pan, and stage interaction

### Phase 2: Grading UI Integration
**Goal**: Color grading controls in the pipeline-checker are the real `ui/` project components, not duplicates
**Depends on**: Phase 1
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. The pipeline-checker's color grading panel uses Slider, Select, ColorWheel, LiftGammaGain, and Section components imported from or matching the `ui/` project exactly
  2. The grading controls' visual appearance matches the existing `ui/` project's Tailwind theme
  3. All parameter names, value ranges, and defaults match those defined in `ui/src/types/settings.ts`
  4. No duplicated or custom grading UI code remains in the pipeline-checker source
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md -- Copy ui/ components, install deps, configure Tailwind v4 surface palette, create enum mapping layer
- [x] 02-02-PLAN.md -- Rewrite ControlsPanel with ui/ grading components, update peripheral imports, delete old ui/ directory

### Phase 3: GPU Testing Framework
**Goal**: Every pipeline module is verified by automated tests that actually run WebGPU shaders and validate output
**Depends on**: Phase 1
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06
**Status**: Deferred to future milestone
**Plans**: TBD

</details>

<details>
<summary>v1.1 Usability Polish (Phases 4-6)</summary>

### Phase 4: Interaction Clarity
**Goal**: User can always identify and select the active stage without accidental interactions
**Depends on**: Phase 2
**Requirements**: INTX-01, INTX-02, INTX-03
**Success Criteria** (what must be TRUE):
  1. User can click a stage's enable/disable checkbox without the main preview switching to that stage
  2. User can instantly identify the active stage in the filmstrip by its distinct blue border (not a subtle gray)
  3. User can read the name of the currently viewed stage in the preview header area, next to the 2D/3D view buttons
**Plans**: 1 plan

Plans:
- [x] 04-01: Fix click areas, add blue highlight, show stage name in header

### Phase 5: Display Logic
**Goal**: Pipeline display behavior is correct for both EXR and DDS workflows without manual adjustment
**Depends on**: Phase 2
**Requirements**: DISP-01, DISP-02, DISP-03
**Success Criteria** (what must be TRUE):
  1. Final Display stage output always shows sRGB-curved values regardless of the vvvv viewer toggle position
  2. Toggling the vvvv viewer toggle visibly changes stages before Final Display but has no effect on Final Display itself
  3. When a DDS file is loaded, stages 0 (EXR Load) and 1 (BC Compress) appear grayed out and cannot be selected as the active view
**Plans**: 1 plan

Plans:
- [x] 05-01: sRGB scoping for Final Display, DDS stage graying

### Phase 6: Tooltips
**Goal**: User can discover what each pipeline stage and UI control does without external documentation
**Depends on**: Phase 4
**Requirements**: TIPS-01, TIPS-02
**Success Criteria** (what must be TRUE):
  1. Hovering over any pipeline stage thumbnail for ~1 second shows a tooltip describing what that stage does in the pipeline
  2. Hovering over any UI control (toggles, dropdowns, buttons) for ~1 second shows a tooltip explaining its function
  3. Tooltips do not obscure the main preview area or interfere with color perception
**Plans**: TBD

Plans:
- [ ] 06-01: Add tooltips to pipeline stages and UI controls

</details>
n### Phase 6.1: Session Persistence (INSERTED)
**Goal**: Dropped image and selected view persist across page reload
**Depends on**: Phase 5
**Requirements**: PERS-01, PERS-02
**Success Criteria** (what must be TRUE):
  1. After dropping an EXR or DDS file and reloading the page, the same image is restored and displayed
  2. The previously selected stage is restored after reload
**Plans**: 1 plan

Plans:
- [x] 6.1-01: IndexedDB image persistence and localStorage view state

### v1.2 Shader Transpiler

**Milestone Goal:** Automate SDSL-to-WGSL conversion so the pipeline-checker's shaders are always mathematically identical to the Stride shaders -- single source of truth, no hand-porting.

### Phase 7: SDSL Stage Shaders
**Goal**: Each pipeline stage has its own standalone SDSL TextureFX shader that composes from existing mixins with no dead code
**Depends on**: Nothing (uses existing Stride shaders as composition sources)
**Requirements**: SDSL-01, SDSL-02, SDSL-03
**Success Criteria** (what must be TRUE):
  1. Six SDSL TextureFX shaders exist (input-convert, color-grade, rrt, odt, output-encode, display-remap), each corresponding to one pipeline stage
  2. Each shader composes from existing mixins (ColorSpaceConversion, HDRGrade_TextureFX, HDRTonemap_TextureFX, etc.) and contains only the functions needed for that stage
  3. Each shader compiles and renders correctly as a standalone TextureFX node in vvvv/Stride
**Plans**: 1 plan

Plans:
- [ ] 07-01-PLAN.md -- Create 6 per-stage SDSL TextureFX shaders and verify in Stride

### Phase 8: Transpiler Tool
**Goal**: A .NET console app converts the 6 SDSL stage shaders to ready-to-use WGSL files via the Stride compiler, DXC, and Naga toolchain
**Depends on**: Phase 7 (needs SDSL shaders to transpile)
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04
**Success Criteria** (what must be TRUE):
  1. Running the transpiler console app at `tools/ShaderTranspiler/` produces 6 WGSL files in `pipeline-checker/src/shaders/generated/`
  2. The transpiler uses Stride NuGet packages to compile SDSL to HLSL (not manual parser init)
  3. The transpiler invokes DXC (HLSL to SPIR-V) and Naga (SPIR-V to WGSL) as part of its pipeline
  4. Generated WGSL files are syntactically valid and contain the expected entry points and bindings
**Plans**: TBD

### Phase 9: Verification & Integration
**Goal**: Generated WGSL is proven mathematically identical to hand-ported WGSL and replaces it in the pipeline checker
**Depends on**: Phase 8 (needs generated WGSL to verify)
**Requirements**: VRFY-01, VRFY-02, INTG-01, INTG-02
**Success Criteria** (what must be TRUE):
  1. An automated verification script validates mathematical parity between SDSL and generated WGSL (transfer function round-trips, matrix compositions, mid-gray passthrough)
  2. Pipeline checker renders identically when using generated WGSL compared to the current hand-ported WGSL
  3. Generated WGSL files replace the hand-ported files and the pipeline checker builds and runs successfully
  4. Generated WGSL files are committed to git as on-demand output (transpiler is not part of the build process)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 7 -> 8 -> 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Pipeline Rendering | v1.0 | 2/2 | Complete | 2026-02-22 |
| 2. Grading UI Integration | v1.0 | 2/2 | Complete | 2026-02-22 |
| 3. GPU Testing Framework | v1.0 | 0/2 | Deferred | - |
| 4. Interaction Clarity | v1.1 | 1/1 | Complete | 2026-02-22 |
| 5. Display Logic | v1.1 | 1/1 | Complete | 2026-02-22 |
| 6. Tooltips | 1/1 | Complete    | 2026-02-22 | - |
| 6.1 Session Persistence | v1.1 | 1/1 | Complete | 2026-02-22 |
| 7. SDSL Stage Shaders | v1.2 | 0/1 | Planned | - |
| 8. Transpiler Tool | v1.2 | 0/? | Not started | - |
| 9. Verification & Integration | v1.2 | 0/? | Not started | - |
