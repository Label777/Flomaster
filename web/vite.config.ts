import { defineConfig } from 'vite';

// Куда dev-сервер проксирует /api и /rtc (см. README.md).
const apiTarget = process.env.DEV_API_TARGET ?? 'http://localhost:8080';

// Изоляция origin: те же заголовки ставит Caddy в продакшене.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // Путь сайта: '/' на своём домене, '/<repo>/' на GitHub Pages (задаёт workflow pages.yml).
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2022',
    // .wasm и .pk3 никогда не встраиваются в base64 — только отдельными файлами.
    assetsInlineLimit: (filePath: string) => (/\.(wasm|pk3)$/i.test(filePath) ? false : undefined),
  },
  optimizeDeps: {
    exclude: ['xash3d-fwgs', 'cs16-client'],
  },
  server: {
    headers: isolationHeaders,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/rtc': { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
  preview: {
    headers: isolationHeaders,
  },
});
