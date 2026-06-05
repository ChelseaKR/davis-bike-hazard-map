import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e configuration.
 *
 * The web server is the real production setup: the Fastify server serving the
 * built PWA from ./dist plus the API, on one port. Geolocation is granted and
 * pinned to central Davis so the report flow can auto-fill location.
 */
const PORT = 8788;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    permissions: ['geolocation'],
    geolocation: { latitude: 38.5449, longitude: -121.7405 },
    locale: 'en-US',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // SW disabled for e2e so offline/online transitions are deterministic; the
    // offline capture→sync DoD is fully exercised without it (the SW still
    // ships in production builds).
    command:
      'cross-env PWA_DISABLE=true npm run build && cross-env NODE_ENV=production ' +
      `MODERATION_TOKEN=e2e-token PORT=${PORT} API_PORT=${PORT} DATABASE_PATH= tsx server/index.ts`,
    url: `${BASE_URL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
