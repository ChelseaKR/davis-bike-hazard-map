import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openTab, seedApprovedHazard } from './helpers.ts';

/**
 * Reports by month, and recurrence labels (issue #180), in a real browser.
 *
 * The harness runs the DEFAULT configuration, in which recurrence labels and the
 * ranking are not published, so the first tests are about what a default
 * deployment does: trends, and two endpoints that refuse. The label rendering is
 * driven by answering `/api/hazards/recurrence` in the browser with the body the
 * server sends when the flag is on.
 *
 * Numbers are read from the API inside the test rather than hard-coded: this
 * suite shares one in-memory store with every other spec, so the only stable
 * claim is that the table says what the API says.
 */

interface TrendsBody {
  months: { month: string; areas: { name: string; received: number; confirmed: number; resolved: number }[] }[];
  omittedMonths: number;
  seedExcluded: number;
}

const tableRows = (page: Page) =>
  page.locator('.trends-table tbody tr').evaluateAll((rows) =>
    rows.map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? '')),
  );

test('the monthly table says what /api/trends says, and /api/trends agrees with /api/coverage', async ({
  page,
  request,
}, testInfo) => {
  await seedApprovedHazard(request, { lat: 38.5561, lng: -121.7502 }, `E2E trends (${testInfo.project.name})`);

  const trends = (await (await request.get('/api/trends')).json()) as TrendsBody;
  const coverage = (await (await request.get('/api/coverage')).json()) as {
    areas: { name: string; count: number }[];
  };

  // The two public surfaces count one set: no seeded demo data exists in this
  // harness, so the months sum exactly to the coverage tally, area by area.
  expect(trends.seedExcluded).toBe(0);
  for (const { name, count } of coverage.areas) {
    const summed = trends.months.reduce(
      (total, m) => total + (m.areas.find((a) => a.name === name)?.received ?? 0),
      0,
    );
    expect(summed, name).toBe(count);
  }

  await page.goto('/');
  await openTab(page, 'Trends');
  await expect(page.getByRole('table')).toBeVisible();

  // Every month the API reported, in the table, newest first, summed over areas.
  const expected = [...trends.months]
    .reverse()
    .map((m) => [
      m.areas.reduce((t, a) => t + a.received, 0),
      m.areas.reduce((t, a) => t + a.confirmed, 0),
      m.areas.reduce((t, a) => t + a.resolved, 0),
    ]);
  const rows = await tableRows(page);
  expect(rows.map((cells) => cells.slice(1).map(Number))).toEqual(expected);
});

test('a default deployment publishes no recurrence labels, and says nothing about them', async ({
  page,
  request,
}, testInfo) => {
  const id = await seedApprovedHazard(
    request,
    { lat: 38.5528, lng: -121.7461 },
    `E2E recurrence default (${testInfo.project.name})`,
  );

  for (const path of ['/api/hazards/recurrence', '/api/chronic']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
    expect((await res.json()).error, path).toBe('not_published');
  }

  await page.goto('/');
  await openTab(page, 'List');
  await expect(page.getByLabel('Hazard list')).toBeVisible();
  expect(id).toBeTruthy();
  // No label, and no claim that labels failed: not published is not a fault.
  await expect(page.getByText(/separate episode/)).toHaveCount(0);
  await expect(page.getByText(/Labels for recurring reports could not be loaded/)).toHaveCount(0);
});

test('a published label reads the same on the list card and in the map popup', async ({
  page,
}) => {
  // The feed is stubbed to ONE hazard on purpose. This test is about the client
  // rendering one sentence on two surfaces, and the map identifies a marker only
  // by its category in the alt text: with the store shared across specs and both
  // browser projects, several hazards of one category mean several identical
  // markers and `.first()` clicks whichever the DOM happened to order first.
  // (That is exactly how it failed on main, in firefox, after chromium had
  // already seeded one.) The server's own label path is covered by the API tests
  // and by the default-deployment test above.
  const id = 'e2e-recurrence-label';
  const description = 'E2E stubbed hazard for the recurrence label';
  const sentence = 'Reported here in 3 separate episodes since January 2026.';
  const hazard = {
    id,
    category: 'surface_damage',
    severity: 'moderate',
    description,
    location: { lat: 38.5312, lng: -121.7208 },
    photoUrl: null,
    thumbnailUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    expiresAt: Date.now() + 30 * 86_400_000,
    resolvedAt: null,
    handoff: null,
    source: 'report',
  };

  await page.route(
    (url) => url.pathname === '/api/hazards',
    (route) => route.fulfill({ json: { hazards: [hazard], serverTime: Date.now() } }),
  );
  await page.route(
    (url) => url.pathname === '/api/hazards/recurrence',
    (route) =>
      route.fulfill({
        json: {
          badges: [{ hazardId: id, episodes: 3, since: '2026-01' }],
          minEpisodes: 3,
          windowDays: 1095,
          timeZone: 'America/Los_Angeles',
        },
      }),
  );

  await page.goto('/');
  await openTab(page, 'List');
  const card = page.locator('li.hazard-card', { hasText: description });
  await expect(card.locator('.hazard-recurrence-note')).toHaveText(sentence);

  // The same sentence, from the same state, in the popup.
  await page.goto(`/#/hazard/${id}`);
  const marker = page.getByAltText('Surface damage hazard marker');
  await expect(marker).toHaveCount(1);
  await marker.click();
  await expect(page.locator('.map-popup-recurrence')).toHaveText(sentence);
});

test('the monthly table reflows at 320px without splitting a figure across two lines', async ({
  page,
  request,
}, testInfo) => {
  await seedApprovedHazard(request, { lat: 38.5602, lng: -121.7331 }, `E2E trends narrow (${testInfo.project.name})`);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await openTab(page, 'Trends');
  await expect(page.getByRole('table')).toBeVisible();

  const cells = page.locator('.trends-table tbody th, .trends-table tbody td');
  const count = await cells.count();
  // A floor: a scan of an empty table proves nothing about reflow.
  expect(count).toBeGreaterThanOrEqual(4);

  // One line box per cell. A number wrapped onto a second line reports two,
  // which is exactly how a figure gets split in half on a narrow screen.
  const lineBoxes = await cells.evaluateAll((nodes) =>
    nodes.map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getClientRects().length;
    }),
  );
  expect(lineBoxes.filter((n) => n !== 1)).toEqual([]);

  // The table scrolls inside its own container; the page does not scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // And the container that scrolls is reachable by keyboard. This scan is at
  // 320px on purpose: axe's `scrollable-region-focusable` only applies once the
  // element actually overflows, so the desktop-width pass in a11y.spec.ts can be
  // green while a narrow screen is mouse-only -- which is how CI caught it and a
  // desktop run did not.
  await expect(page.locator('.trends-scroll')).toHaveAttribute('tabindex', '0');
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
});
