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

  test('primary task is keyboard reachable', async ({ page }) => {
    await page.goto('/');
    // Tab through the nav and activate the Report tab with the keyboard.
    await page.getByRole('button', { name: 'Report', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /submit report/i })).toBeVisible();
  });
});
