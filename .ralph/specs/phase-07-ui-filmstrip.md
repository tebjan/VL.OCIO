# Phase 7: UI — Filmstrip + Controls

> **Deep-dive reference**: `specs-pipeline-checker/sections/section-07-ui-filmstrip-controls.md` (~763 lines)
> Contains complete component hierarchy, StageCard layout (160x120px), thumbnail rendering approach (160x90 rgba8unorm), all visual states table, complete TypeScript interfaces for all UI primitives (Slider, Vec3Slider, Select, Toggle, Section), full PipelineSettings interface with createDefaultSettings(), usePipeline hook spec, color palette table (surface-950 through surface-100), typography/spacing specs, and responsive breakpoints.

**Goal**: React components for the filmstrip stage cards and right-side controls panel.

## Checklist

- [x] 7.1 Filmstrip component
- [x] 7.2 StageCard component
- [x] 7.3 ControlsPanel component
- [x] 7.4 Reusable Slider, Select, Section components
- [x] 7.5 settings.ts types (mirror C# enums)
- [x] 7.6 Reset button + usePipeline hook
- [ ] 7.7 Verify: `npm run build` passes

## Task 7.1: Filmstrip

Create `src/components/Filmstrip.tsx`:

```typescript
interface FilmstripProps {
  stages: StageInfo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
}
```

- Horizontal scrollable container (`overflow-x: auto`)
- Arrow connectors between cards (CSS `>` or SVG arrows)
- Selected card has accent border
- Disabled cards dimmed with reduced opacity

## Task 7.2: StageCard

Create `src/components/StageCard.tsx`:

Each card:

- 160x90px thumbnail (canvas rendering of stage output, downscaled via blit shader)
- Stage name label
- Enable/disable checkbox
- Visual states: active (highlighted), enabled (normal), disabled (dimmed)

## Task 7.3: ControlsPanel

Create `src/components/ControlsPanel.tsx`:

Organized by pipeline stage:

```
> Input
  Color Space: [dropdown]     # HDRColorSpace enum
  BC Format: [dropdown]       # BCFormat
  BC Quality: [dropdown]
  BC Enabled: [toggle]

> Color Grading
  Grading Space: [dropdown]   # GradingSpace enum
  Exposure: [slider] -10..10
  Contrast: [slider] 0..3
  Saturation: [slider] 0..3
  Temperature: [slider] -1..1
  Tint: [slider] -1..1
  Highlights: [slider] -1..1
  Shadows: [slider] -1..1
  Vibrance: [slider] -1..1
  Lift: [3x slider] -1..1
  Gamma: [3x slider] 0.01..4
  Gain: [3x slider] 0..4
  Offset: [3x slider] -1..1
  Shadow Color: [3x slider] -1..1
  Midtone Color: [3x slider] -1..1
  Highlight Color: [3x slider] -1..1
  Highlight Soft Clip: [slider] 0..1
  Shadow Soft Clip: [slider] 0..1
  Highlight Knee: [slider] 0..4
  Shadow Knee: [slider] 0..1

> Tonemap
  Operator: [dropdown]        # TonemapOperator enum
  RRT Enabled: [toggle]
  ODT Enabled: [toggle]
  ODT Target: [dropdown]
  Exposure: [slider] -10..10
  White Point: [slider] 0.1..20

> Output
  Encoding: [dropdown]        # HDRColorSpace enum
  Paper White: [slider] 80..500
  Peak Brightness: [slider] 100..10000
  Black Level: [slider] 0..0.1
  White Level: [slider] 0.5..2
```

Sections are collapsible (matching existing VL.OCIO web UI pattern).

## Task 7.4: Reusable UI components

Port or recreate from existing `ui/src/components/`:

- `Slider.tsx` — labeled slider with value display
- `Select.tsx` — dropdown selector
- `Section.tsx` — collapsible section with header

Match visual style of existing VL.OCIO web UI (dark theme, same spacing, same font).

## Task 7.5: Settings types

Create `src/types/settings.ts`:

```typescript
export const HDR_COLOR_SPACES = [
  { value: 0, label: 'Linear Rec.709', name: 'Linear_Rec709' },
  { value: 1, label: 'Linear Rec.2020', name: 'Linear_Rec2020' },
  { value: 2, label: 'ACEScg', name: 'ACEScg' },
  { value: 3, label: 'ACEScc', name: 'ACEScc' },
  { value: 4, label: 'ACEScct', name: 'ACEScct' },
  { value: 5, label: 'sRGB', name: 'sRGB' },
  { value: 6, label: 'PQ Rec.2020 (HDR10)', name: 'PQ_Rec2020' },
  { value: 7, label: 'HLG Rec.2020', name: 'HLG_Rec2020' },
  { value: 8, label: 'scRGB', name: 'scRGB' },
] as const;

export const TONEMAP_OPERATORS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'ACES (Fit)' },
  { value: 2, label: 'ACES 1.3' },
  { value: 3, label: 'ACES 2.0' },
  { value: 4, label: 'AgX' },
  { value: 5, label: 'Gran Turismo' },
  { value: 6, label: 'Uncharted 2' },
  { value: 7, label: 'Khronos PBR Neutral' },
  { value: 8, label: 'Lottes' },
  { value: 9, label: 'Reinhard' },
  { value: 10, label: 'Reinhard Extended' },
  { value: 11, label: 'Hejl-Burgess' },
] as const;

export const GRADING_SPACES = [
  { value: 0, label: 'Log (ACEScct)' },
  { value: 1, label: 'Linear (ACEScg)' },
] as const;

export const BC_FORMATS = [
  { value: 0, label: 'BC1 (DXT1)', gpuFormat: 'bc1-rgba-unorm' },
  // ... through BC7
] as const;
```

## Task 7.6: Pipeline state hook

Create `src/hooks/usePipeline.ts`:

Manages `PipelineSettings` state, stage enable/disable, selected stage index, triggers re-render on change.

Global "Reset" button resets all parameters to defaults. No presets in v1.
