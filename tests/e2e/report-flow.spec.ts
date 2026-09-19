import { test, expect } from '@playwright/test';
import { waitAndApprove, openTab } from './helpers.ts';

/**
 * The definition of done: a cyclist files a hazard (incl. offline), it syncs,
 * a moderator approves it, and it then appears on the map/list.
 */

test('online: file a report, approve it, and see it on the list', async ({ page, request }, testInfo) => {
  // Unique per browser project: all projects hit the same in-memory e2e server,
  // so a shared description would collide across runs.
  const desc = `E2E online (${testInfo.project.name}): pothole in the bike lane on 5th St`;
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
}, testInfo) => {
  const desc = `E2E offline (${testInfo.project.name}): glass on the Russell path`;
  await page.goto('/');

  // Fill the form while online (interactions need no network)...
  await openTab(page, 'Report');
  await page.getByRole('button', { name: /use my location/i }).click();
  await page.getByLabel('Type').selectOption('glass_debris');
  await page.getByPlaceholder(/deep pothole/i).fill(desc);
  await expect(page.getByRole('button', { name: /submit report/i })).toBeEnabled();

  // ...then go offline ONLY for the submit, so the report is captured locally.
  await context.setOffline(true);
  await page.getByRole('button', { name: /submit report/i }).click();
  await expect(page.getByText(/saved offline/i)).toBeVisible();

  // Reconnect, and prove the emulated interface is carrying traffic again
  // BEFORE reopening the app.
  //
  // Not a wait for the app, and not a loosened timeout — it removes a race
  // with the harness. `setOffline(false)` returns before WebKit will actually
  // put a new request on the wire, and `startSync` fires its first tick within
  // ~500ms of load. Measured in the Linux WebKit nightly: the queued row
  // reached `state: 'syncing'` at +575ms and was still there at +15,611ms,
  // with no `/api/reports` request event ever emitted and no rejection for the
  // app to record. The request never left the browser. The app's own recovery
  // for that is `STALE_SYNCING_MS` (10 minutes, deliberately generous so a
  // real photo upload on slow mobile data is never re-sent), so nothing inside
  // this test's window can rescue it — the test has to not lose the race.
  //
  // Chromium and Firefox satisfy this on the first poll, so it costs them
  // nothing; if it ever stops being satisfiable the failure names the network,
  // not a locator.
  await context.setOffline(false);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          fetch('/api/health')
            .then((r) => r.ok)
            .catch(() => false),
        ),
      { timeout: 10_000, intervals: [100, 200, 400, 800] },
    )
    .toBe(true);

  // Reopen the app; the sync loop drains the IndexedDB queue.
  await page.goto('/');
  await waitAndApprove(request, desc);

  await page.reload();
  await openTab(page, 'List');
  await expect(page.getByText(desc)).toBeVisible();
});
