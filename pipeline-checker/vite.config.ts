import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
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
