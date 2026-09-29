import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        popup: 'popup.html',
        panel: 'panel.html',
        devtools: 'devtools.html',
        'service-worker': 'src/background/service-worker.ts',
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'service-worker' ? 'assets/service-worker.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
