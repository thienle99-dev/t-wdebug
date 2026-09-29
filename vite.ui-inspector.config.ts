import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    target: 'chrome120',
    emptyOutDir: false,
    outDir: 'dist',
    rollupOptions: {
      input: 'src/content/ui-inspector.ts',
      output: { format: 'iife', entryFileNames: 'capture/ui-inspector.js' },
    },
  },
});
