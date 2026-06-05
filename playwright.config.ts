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

// Local runs use Chromium only (fast, one browser to install). CI sets
// E2E_ALL_BROWSERS to fan out across Firefox and WebKit as well.
const projects = [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }];
if (process.env.E2E_ALL_BROWSERS) {
  projects.push(
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  );
}

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

  projects,

  webServer: {
    // SW disabled for e2e so offline/online transitions are deterministic; the
    // offline capture→sync DoD is fully exercised without it (the SW still
    // ships in production builds).
    // ALLOW_INMEMORY lets this production-mode server boot without a database
    // (e2e uses a throwaway in-memory store).
    command:
      'cross-env PWA_DISABLE=true npm run build && cross-env NODE_ENV=production ' +
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
