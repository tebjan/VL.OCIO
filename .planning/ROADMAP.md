# Roadmap: Pipeline Checker Fix & Integration

## Overview

Fix the broken pipeline-checker rendering so all 10 stages produce visible output, replace the duplicated color grading controls with the existing `ui/` project's components, and build a real GPU testing framework that runs each pipeline module with actual image data and validates results through pixel readback and visual heuristics.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Pipeline Rendering** - Fix all 10 pipeline stages to render visible output with correct texture chaining, toggles, and previews
- [ ] **Phase 2: Grading UI Integration** - Replace duplicated grading controls with the existing `ui/` project's components and styling
- [ ] **Phase 3: GPU Testing Framework** - Build test runner that executes real WebGPU pipeline stages with pixel readback and visual heuristics

## Phase Details

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
- [x] 01-01-PLAN.md — Debug and fix GPU pipeline rendering (shader compilation, texture binding, uniform alignment, stage chaining)
- [x] 01-02-PLAN.md — Fix Preview2D display, filmstrip thumbnails, zoom/pan, and stage interaction

### Phase 2: Grading UI Integration
**Goal**: Color grading controls in the pipeline-checker are the real `ui/` project components, not duplicates
**Depends on**: Phase 1
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. The pipeline-checker's color grading panel uses Slider, Select, ColorWheel, LiftGammaGain, and Section components imported from or matching the `ui/` project exactly
  2. The grading controls' visual appearance (colors, spacing, fonts) matches the existing `ui/` project's Tailwind theme
  3. All parameter names, value ranges, and defaults in the pipeline-checker match those defined in `ui/src/types/settings.ts`
  4. No duplicated or custom grading UI code remains in the pipeline-checker source
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — Copy ui/ components, install deps, configure Tailwind v4 surface palette, create enum mapping layer
- [ ] 02-02-PLAN.md — Rewrite ControlsPanel with ui/ grading components, update peripheral imports, delete old ui/ directory

### Phase 3: GPU Testing Framework
**Goal**: Every pipeline module is verified by automated tests that actually run WebGPU shaders and validate output
**Depends on**: Phase 1
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06
**Success Criteria** (what must be TRUE):
  1. Running the test suite loads a real EXR image, executes the full pipeline through WebGPU, and reports pass/fail for the end-to-end run
  2. Each pipeline module (input convert, color grade, RRT, ODT, output encode, display remap) has its own test that runs the module's shader independently and validates its output via GPU pixel readback
  3. Tests apply visual heuristics beyond exact pixel matching -- checking brightness ranges, NaN/Inf absence, and color channel bounds -- and these heuristics catch intentionally broken inputs
  4. The test runner prints a per-module pass/fail report with diagnostic details (actual vs. expected values, which heuristic failed) on any failure
**Plans**: TBD

Plans:
- [ ] 03-01: Test scaffolding and per-module GPU tests
- [ ] 03-02: End-to-end pipeline test and heuristics

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Pipeline Rendering | 2/2 | Complete | 2026-02-22 |
| 2. Grading UI Integration | 0/2 | Not started | - |
| 3. GPU Testing Framework | 0/2 | Not started | - |
