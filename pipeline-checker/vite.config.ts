import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@vl-ocio/webgpu-bc-encoder': path.resolve(__dirname, 'packages/webgpu-bc-encoder/src/index.ts'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
  ],
  assetsInclude: ['**/*.exr'],
  build: {
    target: 'esnext',
    assetsInlineLimit: 100_000_000, // Inline everything as base64
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
