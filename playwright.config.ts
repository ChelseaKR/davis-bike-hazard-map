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

// Browser selection: local runs use Chromium only (fast, one install).
//   E2E_BROWSERS=chromium,firefox   explicit comma list (takes precedence)
//   E2E_ALL_BROWSERS=1              chromium + firefox + webkit
// CI runs chromium+firefox as the required gate and webkit as a separate
// nightly job (.github/workflows/e2e-webkit-nightly.yml) — advisory, because
// the pre-launch Safari/iOS pass is a device pass, but no longer non-blocking:
// the nightly reports its own failure.
const ALL = {
  chromium: { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  firefox: { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  webkit: { name: 'webkit', use: { ...devices['Desktop Safari'] } },
} as const;
const selected: (keyof typeof ALL)[] = process.env.E2E_BROWSERS
  ? (process.env.E2E_BROWSERS.split(',').map((b) => b.trim()) as (keyof typeof ALL)[])
  : process.env.E2E_ALL_BROWSERS
    ? ['chromium', 'firefox', 'webkit']
    : ['chromium'];
const projects = selected.filter((b) => b in ALL).map((b) => ALL[b]);

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
    //
    // CSP_UPGRADE_INSECURE_REQUESTS=false is load-bearing and must not be
    // dropped: this harness serves the production build over plain http on
    // localhost, and WebKit — unlike Chromium and Firefox — honours
    // `upgrade-insecure-requests` on loopback, so with it on, every asset is
    // fetched over https:// against a plaintext port and the app never boots.
    // Nothing under test loads an absolute http:// URL, so the directive is a
    // no-op here in every browser. Pinned by tests/unit/securityHeaders.test.ts.
    //
    // ROUTING_URL= (empty) is load-bearing as well: an empty routing URL makes
    // the planner answer with its straight-line fallback, immediately and with
    // no network. The default is the public OSRM demo server, and a third party's
    // uptime must never decide whether this suite is green -- the rule the map
    // picker scan already applies to tiles. A spec that needs a real multi-route
    // answer stubs `/api/route` in the browser instead
    // (tests/e2e/route-profiles.spec.ts).
    //
    // The rate limits are raised for the same kind of reason. Every request in
    // this suite comes from one IP inside one 60-second window, and the server's
    // production defaults (120 requests/minute, 30 reports/hour) are a property
    // of the deployment, not of anything under test: nothing in tests/e2e
    // asserts a 429. Left at the defaults, CI failed with a moderation approve
    // answering 429 and a page whose own feed request was refused -- a limit the
    // suite hit by being a suite, reported as a broken feature.
    command:
      'cross-env PWA_DISABLE=true npm run build && cross-env NODE_ENV=production ' +
      'ALLOW_INMEMORY=true SESSION_SECRET=e2e-secret CSP_UPGRADE_INSECURE_REQUESTS=false ROUTING_URL= ' +
      'RATE_LIMIT_MAX=100000 REPORTS_PER_HOUR=100000 CONFIRMATIONS_PER_HOUR=100000 ' +
      'MODERATOR_USERNAME=e2e MODERATOR_PASSWORD=e2e-password ' +
      `PORT=${PORT} API_PORT=${PORT} DATABASE_PATH= tsx server/index.ts`,
    url: `${BASE_URL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
