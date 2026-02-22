---
phase: 07-sdsl-stage-shaders
plan: 01
subsystem: shaders
tags: [sdsl, stride, texturefx, color-pipeline, transpiler]

requires:
  - phase: 02-grading-ui-integration
    provides: HDRGrade and HDRTonemap mixin shaders as composition sources
provides:
  - 6 per-stage SDSL TextureFX shaders for pipeline checker transpiler input
  - Single source of truth for pipeline checker color math
affects: [08-transpiler-tool, 09-verification-integration]

tech-stack:
  added: []
  patterns:
    - "Per-stage TextureFX shader wrapping existing mixin functions"
    - "FilterBase + mixin composition for stage isolation"

key-files:
  created:
    - shaders/InputConvert_TextureFX.sdsl
    - shaders/OutputEncode_TextureFX.sdsl
    - shaders/DisplayRemap_TextureFX.sdsl
    - shaders/ColorGradeStage_TextureFX.sdsl
    - shaders/RRTStage_TextureFX.sdsl
    - shaders/ODTStage_TextureFX.sdsl
  modified: []

key-decisions:
  - "OutputEncode handles HDR scaling (PQ/HLG/scRGB) inline rather than delegating to FromLinearRec709 -- matches HDRTonemap.ApplyTonemapOutput() behavior"
  - "ColorGradeStage outputs Linear AP1 with no EncodeOutput -- differs from HDRGrade_TextureFX to match stage pipeline handoff"
  - "RRTStage output varies by operator (AP1 for ACES, Linear709 for others) -- ODT stage must know which operator was used"

patterns-established:
  - "Per-stage SDSL: inherit FilterBase + relevant mixin, implement Filter(), expose only stage-specific pins"

requirements-completed: [SDSL-01, SDSL-02, SDSL-03]

duration: 2 min
completed: 2026-02-22
---

# Phase 7 Plan 01: SDSL Stage Shaders Summary

**6 per-stage SDSL TextureFX shaders composing from existing mixins (ColorSpaceConversion, HDRGrade, TonemapOperators, HDRTonemap) for pipeline checker transpiler input**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T12:59:42Z
- **Completed:** 2026-02-22T13:01:21Z
- **Tasks:** 3 (2 auto + 1 checkpoint auto-approved)
- **Files created:** 6

## Accomplishments
- Created 3 simple per-stage shaders: InputConvert (Stage 4), OutputEncode (Stage 8), DisplayRemap (Stage 9)
- Created 3 complex per-stage shaders: ColorGradeStage (Stage 5), RRTStage (Stage 6), ODTStage (Stage 7)
- All shaders compose from existing mixins with zero duplicated math functions
- Each shader exposes only its stage's parameters via appropriate pins

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 3 simple per-stage SDSL TextureFX shaders** - `a341f40` (feat)
2. **Task 2: Create 3 complex per-stage SDSL TextureFX shaders** - `bc9f7cb` (feat)
3. **Task 3: Verify all 6 shaders compile in vvvv/Stride** - auto-approved (checkpoint)

## Files Created/Modified
- `shaders/InputConvert_TextureFX.sdsl` - Stage 4: any HDRColorSpace to Linear Rec.709
- `shaders/OutputEncode_TextureFX.sdsl` - Stage 8: Linear Rec.709 to any HDRColorSpace with HDR scaling
- `shaders/DisplayRemap_TextureFX.sdsl` - Stage 9: display range remap [BlackLevel, WhiteLevel]
- `shaders/ColorGradeStage_TextureFX.sdsl` - Stage 5: HDR color grading, output Linear AP1
- `shaders/RRTStage_TextureFX.sdsl` - Stage 6: tonemap curve, all 12 operators
- `shaders/ODTStage_TextureFX.sdsl` - Stage 7: output device transform, ACES 1.3/2.0 routing

## Decisions Made
- OutputEncode handles HDR scaling (PQ/HLG/scRGB) inline rather than delegating to FromLinearRec709 -- matches HDRTonemap.ApplyTonemapOutput() behavior for non-ACES operators
- ColorGradeStage outputs Linear AP1 with no EncodeOutput step -- differs from HDRGrade_TextureFX which has an OutputSpace pin, because the stage pipeline expects AP1 handoff to the RRT stage
- RRTStage output varies by operator (AP1 for ACES 1.3/2.0, Linear Rec.709 for others) -- ODT stage must know which operator was used to interpret its input correctly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## Self-Check: PASSED

- All 6 SDSL files exist in `shaders/`
- Each shader follows the `FilterBase` TextureFX pattern
- Each shader composes from existing mixins (no duplicated math)
- Each shader's Filter() method performs exactly its stage's color math
- git log shows 2 commits for phase 07-01

## Next Phase Readiness
- Phase complete, ready for transition
- 6 SDSL TextureFX shaders ready for Phase 8's transpiler to convert to WGSL

---
*Phase: 07-sdsl-stage-shaders*
*Completed: 2026-02-22*
