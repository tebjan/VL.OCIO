# Phase 10: Build & Distribution

> **Deep-dive reference**: `specs-pipeline-checker/sections/section-10-build-distribution.md` (~732 lines)
> Contains complete vite.config.ts with rationale for every setting, WGSL shader import audit commands (grep patterns to verify no fetch()), sample EXR embedding strategy, build verification script (verify-build.mjs ~120 lines), size budget breakdown table, file:// protocol constraints checklist, browser compatibility table (Chrome/Firefox/Safari), performance targets (< 3s load, < 16ms per-frame, < 500MB memory), comprehensive verification procedures, and troubleshooting section. **Read it for the build verification script and performance targets.**

**Goal**: Standalone `index.html` (~5-10 MB) that works by double-clicking in Chrome.

## Checklist

- [x] 10.1 Vite build config for single-file output
- [x] 10.2 WGSL shader embedding via ?raw imports
- [ ] 10.3 Build and verify file:// protocol works
- [ ] 10.4 Size optimization (target < 10 MB)
- [ ] 10.5 Verify: `dist/index.html` opens, WebGPU inits, sample EXR loads

## Task 10.1: Vite build config

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      }
    },
    assetsInlineLimit: 100 * 1024 * 1024,
    target: 'esnext',
    chunkSizeWarningLimit: 5000,
  },
});
```

`vite-plugin-singlefile` inlines all JS and CSS into `index.html`.

## Task 10.2: WGSL shader embedding

Import WGSL files as raw strings (never use `fetch()`):

```typescript
import colorGradeWGSL from '../shaders/generated/color-grade.wgsl?raw';
```

Vite inlines these as string literals in the JS bundle.

## Task 10.3: Verify

```bash
cd pipeline-checker
npm run build
# Open dist/index.html directly in Chrome (file:// protocol)
```

Check: WebGPU initializes, sample EXR loads, all 10 stages render, controls work, 3D view works.

## Task 10.4: Size optimization

Major contributors:

- Three.js (~1.5 MB minified)
- React + ReactDOM (~150 KB)
- WGSL shaders (~50 KB)
- BC encoder WGSL (~100 KB)
- EXRLoader (~100 KB)

If > 10 MB: tree-shake Three.js (only import what's needed), use `three/addons` imports.
