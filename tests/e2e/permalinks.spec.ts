import { test, expect, type APIRequestContext } from '@playwright/test';
import { MOD_USER, MOD_PASS, openTab } from './helpers.ts';

/**
 * URL/navigation state (FIX-08): tabs, filters, and hazards are shareable
 * permalinks in `location.hash`, the back/forward buttons navigate views, and
 * /#/hazard/:id deep links land focused on the hazard.
 */

/** Seed an approved hazard via the API and return its id. */
async function seedApprovedHazard(
  request: APIRequestContext,
  description: string,
): Promise<string> {
  const created = await request.post('/api/reports', {
    headers: { 'content-type': 'application/json' },
    data: {
      category: 'dangerous_intersection',
      severity: 'high',
      description,
      // Away from the Davis-centre geolocation other specs report at, so this
      // marker never clusters with theirs.
      location: { lat: 38.553, lng: -121.72 },
      photo: null,
      clientId: crypto.randomUUID(),
      capturedAt: Date.now(),
    },
  });
  expect(created.status()).toBe(201);
  const { hazard } = (await created.json()) as { hazard: { id: string } };

  const login = await request.post('/api/auth/login', {
    headers: { 'content-type': 'application/json' },
    data: { username: MOD_USER, password: MOD_PASS },
  });
  const { token } = (await login.json()) as { token: string };
  await request.post(`/api/moderation/${hazard.id}`, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: { decision: 'approve' },
  });
  return hazard.id;
}

test('a /#/hazard/:id deep link opens cold on the map, focused on the hazard', async ({
  page,
  request,
}, testInfo) => {
  const desc = `E2E permalink (${testInfo.project.name}): hazard deep link`;
  const id = await seedApprovedHazard(request, desc);

  await page.goto(`/#/hazard/${id}`);

  await expect(page.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // The deep link resolved to focus-on-map: the hazard's marker is on screen.
  await expect(page.getByAltText('Dangerous intersection hazard marker').first()).toBeVisible();
  // The permalink survives as the shareable URL.
  expect(page.url()).toContain(`#/hazard/${id}`);
});

test('browser back/forward move between tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await openTab(page, 'List');
  await expect(page).toHaveURL(/#\/list$/);
  await openTab(page, 'Coverage');
  await expect(page).toHaveURL(/#\/coverage$/);

  await page.goBack();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goBack();
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goForward();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('applied filters are encoded in the URL and restored from a copied link', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByLabel('Minimum severity').selectOption('high');
  await expect(page).toHaveURL(/#\/map\?severity=high$/);

  // "Copy the URL" and open it in a fresh page: the filter is applied.
  const shared = await context.newPage();
  await shared.goto(page.url());
  await expect(shared.getByLabel('Minimum severity')).toHaveValue('high');
  await shared.close();
});
