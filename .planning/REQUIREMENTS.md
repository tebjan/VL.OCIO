# Requirements: Pipeline Checker

**Defined:** 2026-02-22
**Core Value:** The user should always know what they're looking at and be able to inspect any stage without accidental interactions

## v1.0 Requirements (Validated)

### Pipeline Fix

- [x] **PIPE-01**: All 10 pipeline stages render visible output when an EXR image is loaded
- [x] **PIPE-02**: Stage-to-stage texture chaining works correctly (each stage reads previous stage's output)
- [x] **PIPE-03**: Stage enable/disable toggles work and bypass stages correctly
- [x] **PIPE-04**: Filmstrip shows correct preview thumbnails for each stage
- [x] **PIPE-05**: 2D preview displays the selected stage's output with zoom/pan working

### UI Integration

- [x] **UI-01**: Color grading controls use the exact components from the existing `ui/` project (Slider, Select, ColorWheel, LiftGammaGain, Section)
- [x] **UI-02**: Tailwind theme and styling matches the existing `ui/` project exactly
- [x] **UI-03**: Color grading parameter names, ranges, and defaults match the existing `ui/` settings types
- [x] **UI-04**: Remove all duplicated/custom grading UI code from pipeline-checker

## v1.1 Requirements

Requirements for usability polish milestone. Each maps to roadmap phases.

### Interaction

- [x] **INTX-01**: User can click stage enable/disable checkbox without accidentally selecting that stage as the active view
- [x] **INTX-02**: User can identify the active stage at a glance via a blue border highlight on its card
- [x] **INTX-03**: User can see the name of the currently viewed stage in the preview header (next to the 2D/3D buttons)

### Display Logic

- [x] **DISP-01**: Final Display stage always renders with sRGB curve applied, regardless of the vvvv viewer toggle state
- [x] **DISP-02**: The vvvv viewer toggle only affects stages before Final Display
- [x] **DISP-03**: When a DDS file is loaded, stages 0 (EXR Load) and 1 (BC Compress) are visually grayed out and unavailable

### Tooltips

- [x] **TIPS-01**: Each pipeline stage thumbnail shows an explanatory tooltip describing what that stage does (appears after ~1s delay)
- [x] **TIPS-02**: Each UI control in the pipeline/display panels shows an explanatory tooltip describing its function (appears after ~1s delay)

### Session Persistence

- [x] **PERS-01**: After dropping an image file and reloading the page, the same image is restored from IndexedDB and displayed
- [x] **PERS-02**: The previously selected stage index is restored from localStorage after reload

## v1.2 Requirements

Requirements for shader transpiler milestone. Ensures SDSL is the single source of truth.

### SDSL Stage Shaders

- [ ] **SDSL-01**: Each pipeline stage (input-convert, color-grade, rrt, odt, output-encode, display-remap) has its own SDSL TextureFX shader that composes from existing mixins
- [ ] **SDSL-02**: Per-stage SDSL shaders contain only the functions needed for that stage (no dead code)
- [ ] **SDSL-03**: Per-stage SDSL shaders work in Stride/vvvv as standalone TextureFX nodes

### Transpiler Tool

- [ ] **TOOL-01**: .NET 8 console app at `tools/ShaderTranspiler/` references Stride NuGet packages for SDSL to HLSL
- [ ] **TOOL-02**: Transpiler invokes DXC to convert HLSL to SPIR-V
- [ ] **TOOL-03**: Transpiler invokes Naga to convert SPIR-V to WGSL
- [ ] **TOOL-04**: Transpiler produces 6 ready-to-use WGSL files in `pipeline-checker/src/shaders/generated/`

### Verification

- [ ] **VRFY-01**: Automated script validates mathematical parity between SDSL and generated WGSL (transfer function round-trips, matrix compositions, mid-gray passthrough)
- [ ] **VRFY-02**: Pipeline checker renders identically with generated WGSL vs. the current hand-ported WGSL

### Integration

- [ ] **INTG-01**: Generated WGSL files replace hand-ported files and pipeline checker builds successfully
- [ ] **INTG-02**: Generated WGSL files are committed to git (transpiler runs on-demand, not at build time)

## Future Requirements

### Testing Framework (deferred from v1.0)

- **TEST-01**: Testing framework can load an EXR test image and run it through the full pipeline
- **TEST-02**: Each pipeline stage is tested individually
- **TEST-03**: Tests perform pixel readback from GPU and compare against expected values
- **TEST-04**: Tests include visual heuristics (brightness range, no NaN/Inf, channel bounds)
- **TEST-05**: Tests run end-to-end pipeline and verify final output
- **TEST-06**: Test runner reports pass/fail per module with diagnostic output

## Out of Scope

| Feature | Reason |
|---------|--------|
| GPU testing framework | Deferred from v1.0, separate concern |
| preview-blit.wgsl transpilation | Pipeline-checker UI code, not SDSL-sourced color math |
| Modifying existing monolithic SDSL shaders | New per-stage shaders compose from them |
| Build-time transpilation | WGSL committed to git, transpiler runs on-demand |
| C++/CLI OCIO wrapper changes | Transpiler is a separate tool |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PIPE-01 | Phase 1 | Complete |
| PIPE-02 | Phase 1 | Complete |
| PIPE-03 | Phase 1 | Complete |
| PIPE-04 | Phase 1 | Complete |
| PIPE-05 | Phase 1 | Complete |
| UI-01 | Phase 2 | Complete |
| UI-02 | Phase 2 | Complete |
| UI-03 | Phase 2 | Complete |
| UI-04 | Phase 2 | Complete |
| INTX-01 | Phase 4 | Complete |
| INTX-02 | Phase 4 | Complete |
| INTX-03 | Phase 4 | Complete |
| DISP-01 | Phase 5 | Complete |
| DISP-02 | Phase 5 | Complete |
| DISP-03 | Phase 5 | Complete |
| TIPS-01 | Phase 6 | Complete |
| TIPS-02 | Phase 6 | Complete |
| PERS-01 | Phase 6.1 | Complete |
| PERS-02 | Phase 6.1 | Complete |
| SDSL-01 | Phase 7 | Pending |
| SDSL-02 | Phase 7 | Pending |
| SDSL-03 | Phase 7 | Pending |
| TOOL-01 | Phase 8 | Pending |
| TOOL-02 | Phase 8 | Pending |
| TOOL-03 | Phase 8 | Pending |
| TOOL-04 | Phase 8 | Pending |
| VRFY-01 | Phase 9 | Pending |
| VRFY-02 | Phase 9 | Pending |
| INTG-01 | Phase 9 | Pending |
| INTG-02 | Phase 9 | Pending |

**Coverage:**

- v1.2 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0

---

*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after Phase 6.1 completion*
