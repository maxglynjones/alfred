import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
let backendOrigin = '';
try {
  if (process.env.ALFRED_BUILD_GENERIC === '1')
    throw Object.assign(new Error('Generic build'), { code: 'ENOENT' });
  const d = JSON.parse(readFileSync(new URL('.local/deployment.json', import.meta.url), 'utf8'));
  const u = new URL(d.backendOrigin);
  if (u.protocol !== 'https:' || u.origin !== d.backendOrigin)
    throw Error('Invalid deployment origin');
  backendOrigin = u.origin + (d.backendPath || '/alfred');
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
export default defineConfig({
  define: { __ALFRED_BACKEND_ORIGIN__: JSON.stringify(backendOrigin) },
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    cors: false,
    fs: {
      deny: [
        '**/.env*',
        '**/.local/**',
        '**/server/**',
        '**/.git/**',
        '**/scan-to-test.png',
        '**/scan-voice-ai.png',
        '**/*.{crt,pem}',
      ],
    },
    proxy: {
      '/alfred/api': {
        target: backendOrigin.replace(/\/alfred$/, '') || 'http://homeassistant.local:8123',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        index: new URL('index.html', import.meta.url).pathname,
      },
      output: {
        minifyInternalExports: false,
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
