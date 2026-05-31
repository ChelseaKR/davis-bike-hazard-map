import { test, expect } from '@playwright/test';
import { waitAndApprove, openTab } from './helpers.ts';

/**
 * The definition of done: a cyclist files a hazard (incl. offline), it syncs,
 * a moderator approves it, and it then appears on the map/list.
 */

test('online: file a report, approve it, and see it on the list', async ({ page, request }) => {
  const desc = 'E2E online: pothole in the bike lane on 5th St';
  await page.goto('/');
  await openTab(page, 'Report');

  await page.getByRole('button', { name: /use my location/i }).click();
  await page.getByLabel('Type').selectOption('pothole');
  await page.getByPlaceholder(/deep pothole/i).fill(desc);

  const submit = page.getByRole('button', { name: /submit report/i });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(/report saved/i)).toBeVisible();

  // Sync is async; wait for it to reach the server, then a moderator approves.
  await waitAndApprove(request, desc);

  await page.reload();
  await openTab(page, 'List');
  await expect(page.getByText(desc)).toBeVisible();
});

test('offline: a report is saved, then syncs when back online', async ({
  page,
  context,
  request,
}) => {
  const desc = 'E2E offline: glass on the Russell path';
  await page.goto('/');
  await context.setOffline(true);

  await openTab(page, 'Report');
  await page.getByRole('button', { name: /use my location/i }).click();
  await page.getByLabel('Type').selectOption('glass_debris');
  await page.getByPlaceholder(/deep pothole/i).fill(desc);

  const submit = page.getByRole('button', { name: /submit report/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  // Saved locally with an explicit offline acknowledgement.
  await expect(page.getByText(/saved offline/i)).toBeVisible();

  // Back online -> background sync drains the queue; then approve and verify.
  await context.setOffline(false);
  await waitAndApprove(request, desc);

  await page.reload();
  await openTab(page, 'List');
  await expect(page.getByText(desc)).toBeVisible();
});
