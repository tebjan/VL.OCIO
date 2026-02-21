# Phase 1: Project Scaffolding

> **Deep-dive reference**: `specs-pipeline-checker/sections/section-01-project-scaffolding.md` (~1046 lines)
> Contains complete file contents for package.json, vite.config.ts, tsconfig.json, index.html, all starter components (WebGPUContext.ts, DropZone.tsx with halfToFloat helper), raw-imports.d.ts, webgpu.d.ts, sample EXR generation script, 18 acceptance criteria, and Tailwind v4 configuration notes. **Read it if you need exact file templates.**

**Goal**: A running Vite dev server with WebGPU initialized and a dark-themed canvas.

## Checklist

- [x] 1.1 Initialize Vite + React + TypeScript project
- [x] 1.2 WebGPU device initialization
- [x] 1.3 EXR drop zone component
- [x] 1.4 Dark theme setup
- [ ] 1.5 Load Sample EXR button
- [ ] 1.6 Verify: `npm install && npm run build && npx tsc --noEmit`

## Task 1.1: Initialize Vite + React + TypeScript project

Create `pipeline-checker/` directory:

```
pipeline-checker/
  package.json
  vite.config.ts
  tailwind.config.js
  tsconfig.json
  index.html
  src/
    main.tsx
    App.tsx
```

**Dependencies**:

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "three": "^0.171.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@webgpu/types": "^0.1.52",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "vite-plugin-singlefile": "^2.0.0"
  }
}
```

**Vite config**:

- `base: './'` — critical for standalone HTML (relative asset paths)
- `assetsInlineLimit: 100000000` — inline everything as base64
- `build.rollupOptions.output.inlineDynamicImports: true` — single JS bundle
- `plugins: [react(), singleFile()]`

**WGSL shader imports**: Use `?raw` suffix:

```typescript
import shaderCode from './shaders/generated/color-grade.wgsl?raw';
```

**No Web Workers**: BC encoding runs as GPU compute from the main thread. Workers can't be inlined into single HTML.

## Task 1.2: WebGPU device initialization

Create `src/gpu/WebGPUContext.ts`:

```typescript
export interface GPUContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  format: GPUTextureFormat;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<GPUContext> {
  if (!navigator.gpu) {
    throw new Error('WebGPU not supported. Use Chrome 113+ or Edge 113+.');
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance'
  });
  if (!adapter) throw new Error('No WebGPU adapter found.');

  const requiredFeatures: GPUFeatureName[] = [];
  if (adapter.features.has('texture-compression-bc')) {
    requiredFeatures.push('texture-compression-bc');
  }

  const device = await adapter.requestDevice({
    requiredFeatures,
    requiredLimits: {
      maxStorageBufferBindingSize: 256 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
    }
  });

  const format = navigator.gpu.getPreferredCanvasFormat();
  const context = canvas.getContext('webgpu') as GPUCanvasContext;
  context.configure({ device, format, alphaMode: 'premultiplied' });

  return { adapter, device, format };
}
```

## Task 1.3: EXR drop zone component

Create `src/components/DropZone.tsx`:

- Full-screen drop area with dashed border
- Accepts `.exr` files only
- Shows "Drop EXR file here" prompt
- On drop: reads File -> passes to EXR loader
- Transitions to pipeline view after successful load

## Task 1.4: Dark theme setup

Configure Tailwind:

- Background: `#0d0d0d` (near-black, color-neutral)
- Surface: `#1a1a1a` (cards, panels)
- Border: `#2a2a2a` (subtle dividers)
- Text: `#e0e0e0` (high contrast, no blue tint)
- Accent: `#4a4a4a` (active borders, hover states)
- **No saturated accent colors** (would bias color perception)

## Task 1.5: Load Sample EXR button

Bundle a small sample EXR (256x256 HDR gradient, brightness 0.0-10.0+) as base64 in the source.

- Horizontal brightness gradient + vertical hue sweep
- ~200 KB base64 with EXR compression
- "Try with sample image" button below the drop zone
- On click: decode base64, parse as EXR, feed into pipeline
