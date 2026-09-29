import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), localDebugDemo()],
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

function localDebugDemo(): Plugin {
  return {
    name: 'debug-lens-local-demo-api',
    configureServer(server) {
      server.middlewares.use('/__debug-lens-demo-api', (incoming, outgoing) => {
        const request = incoming as unknown as { url?: string; on: (event: string, listener: (chunk?: unknown) => void) => void };
        const response = outgoing as unknown as { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void };
        const node = globalThis as unknown as { URL: new (input: string, base: string) => { searchParams: { get: (name: string) => string | null } }; Buffer: { concat: (chunks: unknown[]) => { toString: (encoding: string) => string } }; setTimeout: (callback: () => void, delay: number) => unknown };
        const url = new node.URL(request.url ?? '/', 'http://localhost');
        const status = Number(url.searchParams.get('status') ?? 200);
        const delay = Math.min(3000, Math.max(0, Number(url.searchParams.get('delay') ?? 0)));
        const chunks: unknown[] = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          node.setTimeout(() => {
            const body = status === 422
              ? { error: 'validation_failed', fields: { email: 'Enter a valid email address.' }, received: node.Buffer.concat(chunks).toString('utf8') }
              : status === 401
                ? { error: 'token_expired', hint: 'This is a demo response; no real credential is used.' }
                : status >= 500
                  ? { error: 'demo_server_error', traceId: 'demo-trace-001' }
                  : { ok: true, data: { id: 123, status, received: node.Buffer.concat(chunks).toString('utf8') } };
            response.statusCode = status;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.setHeader('Cache-Control', 'no-store');
            response.end(JSON.stringify(body));
          }, delay);
        });
      });
    },
  };
}
