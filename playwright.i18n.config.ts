import { defineConfig, devices } from '@playwright/test';

/**
 * G9 pseudolocale-overflow config (INTERNATIONALIZATION-STANDARD §4/§8).
 *
 * Separate from the main e2e config because it builds the app with
 * `VITE_I18N_TEST_HOOKS=1` so `window.__i18nTest` exists — the shipping/production
 * build never sets that flag, so the hook never enters the real bundle. Runs the
 * overflow spec on desktop + mobile viewports. It is intentionally NOT the
 * nightly `e2e-webkit` job and does not touch it.
 */
const PORT = 8789;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/i18n',
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
    locale: 'en-US',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    // Build with the i18n test hook enabled (dev/preview-only), PWA disabled for
    // deterministic loads, and boot the production server against an in-memory store.
    command:
      'cross-env PWA_DISABLE=true VITE_I18N_TEST_HOOKS=1 npm run build && cross-env NODE_ENV=production ' +
      'ALLOW_INMEMORY=true SESSION_SECRET=e2e-secret ' +
      'MODERATOR_USERNAME=e2e MODERATOR_PASSWORD=e2e-password ' +
      `PORT=${PORT} API_PORT=${PORT} DATABASE_PATH= tsx server/index.ts`,
    url: `${BASE_URL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
