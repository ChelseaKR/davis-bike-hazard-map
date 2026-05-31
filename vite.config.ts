import { defineConfig, type UserConfig } from 'vite';
import type { UserConfig as VitestUserConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The dev/preview API port the server listens on (see server/index.ts).
const API_PORT = process.env.API_PORT ?? '8787';

// Plugins are typed against the root `vite`; the Vitest `test` field is typed
// via a type-only import so there's no cross-`vite`-instance plugin clash.
// https://vitejs.dev/config/
const config: UserConfig & { test: VitestUserConfig['test'] } = {
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Inject the SW registration as an external /registerSW.js script (CSP
      // 'self'-safe) so the app doesn't import the virtual module directly.
      injectRegister: 'script-defer',
      // Generate the service worker only for production builds so the dev
      // server and unit tests are never intercepted by a stale cache.
      disable: process.env.NODE_ENV === 'test',
      includeAssets: ['favicon.svg', 'robots.txt', 'icons/*.png'],
      manifest: {
        name: 'Davis Bike Hazard Map',
        short_name: 'Bike Hazards',
        description:
          'Crowdsourced, offline-first cycling-hazard map for Davis, CA. Report potholes, glass, and blocked lanes from your bike.',
        theme_color: '#0b6e4f',
        background_color: '#0d1117',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['navigation', 'utilities', 'travel'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // App shell: navigations fall back to the cached index when offline.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // OpenStreetMap raster tiles — cache-first so the last-seen area
            // stays usable offline, capped so we never balloon on mobile data.
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Public hazard list — network-first so the map is fresh when
            // online but still renders the last payload offline.
            urlPattern: /\/api\/hazards.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'hazard-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Keep Leaflet in its own chunk so the report flow loads fast on
          // mobile data even before the map bundle arrives.
          leaflet: ['leaflet', 'react-leaflet', 'leaflet.markercluster'],
        },
      },
    },
  },
  // Vitest runs unit + component + a11y + server tests in jsdom.
  // (Playwright e2e is configured separately in playwright.config.ts.)
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/lib/**', 'src/components/**', 'src/hooks/**', 'server/**', 'shared/**'],
      exclude: [
        '**/*.d.ts',
        '**/types.ts',
        'server/index.ts',
        // Leaflet view-glue: needs a real browser DOM with layout, so it is
        // covered by the Playwright + axe e2e pass, not jsdom unit tests.
        'src/components/MapView.tsx',
        'src/components/LocationPicker.tsx',
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
};

export default defineConfig(config);
