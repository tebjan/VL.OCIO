# Phase 9: 3D Heightmap Visualization

> **Deep-dive reference**: `specs-pipeline-checker/sections/section-09-3d-heightmap.md` (~871 lines)
> Contains complete HeightmapScene class, full updateInstances() function, all height modifiers pipeline (Range Remap -> Stops -> Perceptual -> Exponent -> Scale), downsample factor table, column mode vs flat mode, OrbitControls setup with double-click reset and F-key frame, default camera position calculation, CPU readback path + GPU compute path (TSL compute with instancedArray), and render loop with activate/deactivate lifecycle.

**Goal**: Three.js WebGPU scene showing pixels as camera-aligned billboards at computed height, using GPU compute (no CPU readback).

**Architecture**: Follows the vvvv "null mesh" pattern — a TSL compute shader reads the stage texture, computes per-pixel position/color/height, writes to GPU storage buffers. `SpriteNodeMaterial` reads from those buffers and renders billboards. Data never leaves the GPU.

## Checklist

- [x] 9.1 Three.js WebGPU renderer + OrbitControls
- [x] 9.2 TSL compute shader for heightmap data
- [x] 9.3 SpriteNodeMaterial billboard rendering
- [x] 9.4 7 height modes (all GPU-side)
- [x] 9.5 HeightmapControls component
- [x] 9.6 Wireframe bounding box
- [ ] 9.7 MainPreview tab toggle (2D/3D)
- [x] 9.8 Camera keyboard shortcuts
- [ ] 9.9 Verify: `npm run build` passes

## Task 9.1: Three.js WebGPU renderer

Create `src/components/HeightmapView.tsx`:

```typescript
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { instancedArray, Fn, instanceIndex, texture, uniform,
         vec2, vec3, dot, clamp, float, int, select } from 'three/tsl';

// WebGPU renderer (NOT WebGLRenderer)
this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
await this.renderer.init();
// Camera at 45 deg elevation
this.camera.position.set(0.7, 0.5, 0.7);
```

## Task 9.2: TSL compute shader

Instead of GPU→CPU→GPU readback, run a compute shader that reads the stage texture directly:

```typescript
// GPU storage buffers — data never leaves GPU
this.positionBuffer = instancedArray(count, 'vec3');
this.colorBuffer = instancedArray(count, 'vec3');

this.computeHeightmap = Fn(() => {
  const idx = instanceIndex;
  const gx = idx.mod(uDsWidth);
  const gy = idx.div(uDsWidth);
  const uv = vec2(gx.add(0.5).div(uDsWidth), gy.add(0.5).div(uDsHeight));
  const pixel = texture(stageTexture, uv);

  // Height from selected mode (all GPU-side via select() chain)
  // ... 7 modes with modifiers (range remap, stops, perceptual, exponent) ...

  this.positionBuffer.element(idx).assign(vec3(x, y, z));
  this.colorBuffer.element(idx).assign(clamp(pixel.rgb, 0.0, 1.0));
})().compute(count);
```

## Task 9.3: Billboard sprite rendering

```typescript
const material = new THREE.SpriteNodeMaterial();
material.positionNode = this.positionBuffer.toAttribute();
material.colorNode = this.colorBuffer.toAttribute();
material.scaleNode = uniform(cellSize);
material.depthWrite = true;
material.depthTest = true;

const mesh = new THREE.Mesh(new THREE.SpriteGeometry(), material);
mesh.count = count;
mesh.frustumCulled = false;
```

**Render loop**:

```typescript
await this.renderer.computeAsync(this.computeHeightmap);
this.controls.update();
this.renderer.render(this.scene, this.camera);
```

## Task 9.4: 7 height modes (all GPU-side)

All run inside TSL compute as uniform-controlled `select()` chain:

| Mode | Value | Computation |
|------|-------|-------------|
| Rec.709 Luminance | 0 | `dot(rgb, vec3(0.2126, 0.7152, 0.0722))` |
| Red | 1 | `r` |
| Green | 2 | `g` |
| Blue | 3 | `b` |
| Max Channel | 4 | `max(r, max(g, b))` |
| RGB Length | 5 | `length(rgb) / sqrt(3)` |
| AP1 Luminance | 6 | `dot(rgb, vec3(0.2722287, 0.6740818, 0.0536895))` |

Modifier pipeline (also GPU): Range Remap → Stops Mode → Perceptual Mode → Exponent.

## Task 9.5: HeightmapControls

Create `src/components/HeightmapControls.tsx`:

- Height Mode: dropdown (7 options)
- Height Scale: slider (0.01 - 2.0, default 0.1)
- Exponent: slider (0.1 - 5.0, default 1.0)
- Stops: toggle (default off)
- Perceptual: toggle (default off)
- Range Min/Max: sliders (0-1)
- Downsample: dropdown (1x, 2x, 4x, 8x, 16x, default 4x)

## Task 9.6: Wireframe bounding box

```typescript
const geometry = new THREE.BoxGeometry(1.0, heightScale, aspect);
const edges = new THREE.EdgesGeometry(geometry);
const material = new THREE.LineBasicMaterial({ color: 0x444444 });
this.wireframeBox = new THREE.LineSegments(edges, material);
```

## Task 9.7: MainPreview tab toggle

Create `src/components/MainPreview.tsx`:

- `[2D]` `[3D]` tab toggle
- 2D tab: `Preview2D` component
- 3D tab: `HeightmapView` component
- Both receive selected stage's output texture
- State preserved when switching tabs

## Task 9.8: Camera shortcuts

- `F` key: frame entire object
- Double-click: reset camera to default position
- All other controls via OrbitControls (built-in)
