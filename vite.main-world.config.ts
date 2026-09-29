import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    target: 'chrome120',
    emptyOutDir: false,
    outDir: 'dist',
    rollupOptions: {
      input: 'src/content/main-world.ts',
      output: { format: 'iife', entryFileNames: 'capture/main-world.js' },
    },
  },
});
