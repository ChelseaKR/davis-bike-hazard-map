import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openTab } from './helpers.ts';

/**
 * Full-page accessibility pass in a real browser (covers colour-contrast and
 * page-structure rules that jsdom can't). Merge-blocking: zero violations.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe('accessibility', () => {
  test('map view has no WCAG A/AA violations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: /davis bike hazard map/i }).waitFor();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
  });

  test('list view has no WCAG A/AA violations', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'List');
    await page.getByLabel('Hazard list').waitFor();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
  });

  test('report form has no WCAG A/AA violations', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Report');
    await page.getByRole('button', { name: /submit report/i }).waitFor();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
  });

  /**
   * The map picker, scanned OPEN.
   *
   * Every other accessibility check in this repository misses this surface, and
   * misses it silently. `ReportForm` renders the picker behind
   * `{showMap && <Suspense><LocationPicker/></Suspense>}`, so until the toggle
   * is pressed it is not hidden — it is **not in the document at all**. The
   * "report form" test above scans that form with the picker absent and passes;
   * so does `tests/unit/ReportForm.test.tsx`, in jsdom. Two green accessibility
   * gates over a component neither of them has ever looked at.
   *
   * That makes this the only check that can say anything about a tap-to-place
   * map with a draggable marker, and it has to run in a real browser: the
   * component is a Leaflet map, which jsdom does not lay out, and the rules most
   * likely to fail on a map — contrast against tile imagery, target size, focus
   * order through the zoom controls — all need painted pixels.
   *
   * If a future surface is put behind a toggle, it needs a test like this one.
   * An automated scan proves nothing about a surface it cannot see.
   */
  test('map picker has no WCAG A/AA violations once it is open', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Report');

    const toggle = page.getByRole('button', { name: /set on map/i });
    await toggle.waitFor();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();

    // The picker is lazily imported, so the click resolves before it mounts.
    // Wait for Leaflet to have initialised the container — not for tiles, which
    // come from a third-party origin and must never decide whether CI is green.
    await expect(page.locator('.location-picker-map.leaflet-container')).toBeVisible();
    await expect(page.getByRole('button', { name: /hide map/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
  });

  test('moderation sign-in has no WCAG A/AA violations', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Moderate');
    await page.getByLabel(/username/i).waitFor();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
  });

  test('primary task is keyboard reachable', async ({ page }) => {
    await page.goto('/');
    // Tab through the nav and activate the Report tab with the keyboard.
    await page.getByRole('button', { name: 'Report', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /submit report/i })).toBeVisible();
  });
});
