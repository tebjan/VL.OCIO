---
phase: 06-tooltips
plan: 01
subsystem: ui
tags: [tooltips, html-title, ux, discoverability, pipeline-checker]

# Dependency graph
requires:
  - phase: 04-interaction-clarity
    provides: StageCard component with checkbox toggle
provides:
  - Native HTML title tooltips on all pipeline stage cards
  - Native HTML title tooltips on all UI controls (toggles, selects, sliders, buttons)
  - description field on StageInfo interface for stage metadata
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wrap shared components (Select, Slider) in <div title='...'> for tooltip propagation"
    - "Add optional title prop to Toggle component for per-instance tooltips"

key-files:
  created: []
  modified:
    - pipeline-checker/src/pipeline/types/StageInfo.ts
    - pipeline-checker/src/hooks/usePipeline.ts
    - pipeline-checker/src/components/StageCard.tsx
    - pipeline-checker/src/components/Toggle.tsx
    - pipeline-checker/src/components/ControlsPanel.tsx
    - pipeline-checker/src/components/HeightmapControls.tsx
    - pipeline-checker/src/components/MainPreview.tsx

key-decisions:
  - "Used native HTML title attributes for tooltips -- zero JS, no tooltip library, no DOM overlays"
  - "Wrapped shared Select/Slider components in <div title> rather than modifying shared component API"

patterns-established:
  - "title-div pattern: wrap shared components in <div title='...'> for tooltip propagation without modifying component API"

requirements-completed: [TIPS-01, TIPS-02]

# Metrics
duration: 5min
completed: 2026-02-22
---

# Phase 6 Plan 1: Add Tooltips Summary

**Native HTML title tooltips on all 9 pipeline stage cards and 25+ UI controls for hover-based discoverability**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-22T12:40:32Z
- **Completed:** 2026-02-22T12:45:09Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Every pipeline stage card shows a descriptive tooltip explaining what the stage does (EXR Load, BC Compress, Color Grade, RRT, ODT, etc.)
- All UI controls (toggles, dropdowns, buttons, non-obvious sliders) show descriptive tooltips on hover
- 2D/3D tab buttons, heightmap controls, and all Display Output controls have tooltips
- Zero runtime overhead -- uses native HTML title attributes with browser-rendered tooltips

## Task Commits

Each task was committed atomically:

1. **Task 1: Add tooltips to pipeline stage cards** - `8abe2b0` (feat)
2. **Task 2: Add tooltips to UI controls** - `ca2cc74` (feat)

## Files Created/Modified
- `pipeline-checker/src/pipeline/types/StageInfo.ts` - Added description field to StageInfo interface and STAGE_NAMES array
- `pipeline-checker/src/hooks/usePipeline.ts` - Populates description field when deriving StageInfo from state
- `pipeline-checker/src/components/StageCard.tsx` - title attribute on thumbnail button, improved checkbox tooltip
- `pipeline-checker/src/components/Toggle.tsx` - Added optional title prop, applied to outermost div
- `pipeline-checker/src/components/ControlsPanel.tsx` - Tooltips on Pipeline, Color Grading, and Display Output controls
- `pipeline-checker/src/components/HeightmapControls.tsx` - Tooltips on all heightmap controls (Mode, Scale, Exponent, Stops, etc.)
- `pipeline-checker/src/components/MainPreview.tsx` - Tooltips on 2D/3D tab buttons

## Decisions Made
- Used native HTML title attributes for tooltips -- zero JS, no tooltip library, no DOM overlays. Browser handles delay and positioning.
- Wrapped shared Select/Slider components in `<div title="...">` rather than adding title props to shared component APIs -- keeps shared components clean.
- Only added tooltips to non-obvious controls. Self-explanatory sliders (Exposure, Contrast, Saturation, Temperature, Tint, etc.) do not have tooltips.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript errors in HeightmapView.tsx cause `tsc -b` to fail (unused locals, Three.js TSL type mismatches). These are unrelated to tooltip changes. Vite build succeeds. Logged to deferred-items.md.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 6 (final phase) is now complete. All usability polish work is done.
- No blockers.

## Self-Check: PASSED

- All 7 modified files exist on disk
- Commit `8abe2b0` (Task 1) verified in git log
- Commit `ca2cc74` (Task 2) verified in git log
- Vite production build succeeds

---
*Phase: 06-tooltips*
*Completed: 2026-02-22*
