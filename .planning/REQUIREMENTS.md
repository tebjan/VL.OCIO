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

- [ ] **TIPS-01**: Each pipeline stage thumbnail shows an explanatory tooltip describing what that stage does (appears after ~1s delay)
- [ ] **TIPS-02**: Each UI control in the pipeline/display panels shows an explanatory tooltip describing its function (appears after ~1s delay)

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
| GPU testing framework | Deferred from v1.0, separate milestone |
| New pipeline stages | Improve existing, don't add new |
| Grading UI redesign | Already integrated in v1.0 Phase 2 |
| Performance optimization | Not a usability concern for this milestone |
| Mobile/touch support | Desktop-only tool |

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
| TIPS-01 | Phase 6 | Pending |
| TIPS-02 | Phase 6 | Pending |

**Coverage:**

- v1.1 requirements: 8 total
- Mapped to phases: 8
- Unmapped: 0

---

*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after v1.1 roadmap created*
