import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    target: 'chrome120',
    emptyOutDir: false,
    outDir: 'dist',
    rollupOptions: {
      input: 'src/content/hook-bridge.ts',
      output: { format: 'iife', entryFileNames: 'capture/hook-bridge.js' },
    },
  },
});
