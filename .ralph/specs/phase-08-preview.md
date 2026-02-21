# Phase 8: UI — Main Preview + Hover Readout

> **Deep-dive reference**: `specs-pipeline-checker/sections/section-08-ui-preview-readout.md` (~593 lines)
> Contains zoom/pan implementation details (mouse wheel centered zoom formula, pointer drag pan), complete preview-blit.wgsl shader, WebGPU pipeline setup for preview rendering, usePixelReadout hook with requestAnimationFrame throttling pattern, PixelReadback staging buffer with 256-byte alignment details, channel stats computation for MetadataPanel, and "View (non-destructive)" section visual design.

**Goal**: 2D preview with zoom/pan and pixel readout overlay.

## Checklist

- [x] 8.1 Preview2D component
- [x] 8.2 PixelReadout overlay
- [x] 8.3 MetadataPanel component
- [x] 8.4 "View (non-destructive)" section
- [ ] 8.5 Verify: `npm run build` passes

## Task 8.1: Preview2D

Create `src/components/Preview2D.tsx`:

- Renders selected stage's output texture to a canvas
- Zoom: mouse wheel (centered on cursor position)
- Pan: click-drag
- Fit-to-view on double-click
- View exposure compensation slider (applies `exp2(viewExposure)` — display only, does NOT affect pipeline math)

**Implementation**: Separate WebGPU render pass sampling stage's `rgba32float` → canvas `preferred format` (typically `bgra8unorm`). Apply view exposure + gamma here.

**Preview blit shader**:

```wgsl
struct ViewUniforms {
    viewExposure: f32,
    zoom: f32,
    panX: f32,
    panY: f32,
};
@group(0) @binding(2) var<uniform> view: ViewUniforms;

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let uv = (in.uv - 0.5) / view.zoom + vec2<f32>(view.panX, view.panY) + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return vec4<f32>(0.05, 0.05, 0.05, 1.0);
    }
    var color = textureSample(stageTexture, stageSampler, uv);
    color = vec4<f32>(color.rgb * exp2(view.viewExposure), color.a);
    color = clamp(color, vec4<f32>(0.0), vec4<f32>(1.0));
    return color;
}
```

## Task 8.2: PixelReadout overlay

Create `src/components/PixelReadout.tsx`:

- Tracks mouse position over preview canvas
- Converts screen coords to texture coords (accounting for zoom/pan)
- Calls `PixelReadback.readPixel()` at max 30 Hz
- Floating tooltip near cursor:

```
(1920, 1080)
R: 0.18342
G: 0.15221
B: 0.09156
A: 1.00000
```

- 5-decimal float (sufficient for float32 precision)
- Semi-transparent dark panel, monospace font

**usePixelReadout hook** (`src/hooks/usePixelReadout.ts`):

Throttle via `requestAnimationFrame` — set `needsRead` on mousemove, read on next frame.

## Task 8.3: MetadataPanel

Create `src/components/MetadataPanel.tsx`:

Displayed when Stage 1 (EXR Load) is selected:

- Resolution: `{width} x {height}`
- Channels: `RGBA Float32`
- File size: `{size} MB`
- Min/Max per channel: `R: [{min}, {max}]`, etc.
- Computed from Float32Array after EXR load

## Task 8.4: "View (non-destructive)" section

The view exposure slider MUST be visually separated from pipeline controls:

- Distinct section header: **"View (non-destructive)"**
- Different header style (italic, muted color, or dashed separator)
- Placed ABOVE the canvas in the preview area, NOT in the right-side controls panel
- Prevents confusion between view exposure (display-only) and grade exposure (Stage 5) or tonemap exposure (Stage 6)
