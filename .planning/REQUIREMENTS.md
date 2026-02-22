# Requirements: Pipeline Checker Fix & Integration

**Defined:** 2026-02-22
**Core Value:** Every pipeline stage must render correctly and be verified by automated tests with real data

## v1 Requirements

### Pipeline Fix

- [x] **PIPE-01**: All 10 pipeline stages render visible output when an EXR image is loaded
- [x] **PIPE-02**: Stage-to-stage texture chaining works correctly (each stage reads previous stage's output)
- [x] **PIPE-03**: Stage enable/disable toggles work and bypass stages correctly
- [ ] **PIPE-04**: Filmstrip shows correct preview thumbnails for each stage
- [ ] **PIPE-05**: 2D preview displays the selected stage's output with zoom/pan working

### UI Integration

- [ ] **UI-01**: Color grading controls use the exact components from the existing `ui/` project (Slider, Select, ColorWheel, LiftGammaGain, Section)
- [ ] **UI-02**: Tailwind theme and styling matches the existing `ui/` project exactly
- [ ] **UI-03**: Color grading parameter names, ranges, and defaults match the existing `ui/` settings types
- [ ] **UI-04**: Remove all duplicated/custom grading UI code from pipeline-checker

### Testing Framework

- [ ] **TEST-01**: Testing framework can load an EXR test image and run it through the full pipeline
- [ ] **TEST-02**: Each pipeline stage (input convert, color grade, RRT, ODT, output encode, display remap) is tested individually
- [ ] **TEST-03**: Tests perform pixel readback from GPU and compare against expected values
- [ ] **TEST-04**: Tests include visual heuristics (not just exact pixel matching) — e.g., brightness in expected range, no NaN/Inf, color channels within bounds
- [ ] **TEST-05**: Tests run end-to-end pipeline and verify final output is visually correct
- [ ] **TEST-06**: Test runner reports pass/fail per module with diagnostic output on failure

## v2 Requirements

### Extended Testing

- **TEST-07**: Automated visual regression testing with reference screenshots
- **TEST-08**: Performance benchmarks per pipeline stage
- **TEST-09**: BC compression quality metrics testing

## Out of Scope

| Feature | Reason |
|---------|--------|
| WebSocket connection to vvvv backend | Pipeline-checker is standalone, not connected to C# server |
| Preset save/load system | Belongs to the `ui/` project's backend integration |
| Multi-instance support | Not needed for standalone pipeline verification |
| Mobile layout | Pipeline-checker is a desktop dev tool |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PIPE-01 | Phase 1 | Complete |
| PIPE-02 | Phase 1 | Complete |
| PIPE-03 | Phase 1 | Complete |
| PIPE-04 | Phase 1 | Pending |
| PIPE-05 | Phase 1 | Pending |
| UI-01 | Phase 2 | Pending |
| UI-02 | Phase 2 | Pending |
| UI-03 | Phase 2 | Pending |
| UI-04 | Phase 2 | Pending |
| TEST-01 | Phase 3 | Pending |
| TEST-02 | Phase 3 | Pending |
| TEST-03 | Phase 3 | Pending |
| TEST-04 | Phase 3 | Pending |
| TEST-05 | Phase 3 | Pending |
| TEST-06 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after initial definition*
