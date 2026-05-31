import { test, expect } from '@playwright/test';
import { approveOldestPending, openTab, MOD_TOKEN } from './helpers.ts';

/**
 * The definition of done: a cyclist files a hazard (incl. offline), it syncs,
 * a moderator approves it, and it then appears on the map/list.
 */

test('online: file a report, approve it, and see it on the list', async ({ page, request }) => {
  await page.goto('/');
  await openTab(page, 'Report');

  await page.getByRole('button', { name: /use my location/i }).click();
  await page.getByLabel('Type').selectOption('pothole');
  await page
    .getByPlaceholder(/deep pothole/i)
    .fill('E2E: pothole in the bike lane on 5th St');

  const submit = page.getByRole('button', { name: /submit report/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByText(/report saved/i)).toBeVisible();

  // Moderator approves it; then it should be public.
  await approveOldestPending(request);

  await page.reload();
  await openTab(page, 'List');
  await expect(page.getByText('E2E: pothole in the bike lane on 5th St')).toBeVisible();
});

test('offline: a report is saved, then syncs when back online', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/');
  await context.setOffline(true);

  await openTab(page, 'Report');
  await page.getByRole('button', { name: /use my location/i }).click();
  await page
    .getByPlaceholder(/deep pothole/i)
    .fill('E2E offline: glass on the Russell path');
  await page.getByText('Glass / debris').click();

  const submit = page.getByRole('button', { name: /submit report/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  // Saved locally with an explicit offline acknowledgement.
  await expect(page.getByText(/saved offline/i)).toBeVisible();

  // Back online -> the background sync drains the queue to the server.
  await context.setOffline(false);

  await expect
    .poll(
      async () => {
        const res = await request.get('/api/moderation/queue', {
          headers: { authorization: `Bearer ${MOD_TOKEN}` },
        });
        const { hazards } = await res.json();
        return hazards.some(
          (h: { description: string | null }) =>
            h.description === 'E2E offline: glass on the Russell path',
        );
      },
      { timeout: 15_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);

  await approveOldestPending(request);
  await page.reload();
  await openTab(page, 'List');
  await expect(page.getByText('E2E offline: glass on the Russell path')).toBeVisible();
});
