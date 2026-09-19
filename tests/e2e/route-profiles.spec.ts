import { test, expect, type Page } from '@playwright/test';
import { answerRoutesWith, stubRoutePlan } from './helpers.ts';

/**
 * The route planner's rider preference (issue #178), in a real browser.
 *
 * The harness runs the server with ROUTING_URL empty (playwright.config.ts), so
 * every real `/api/route` answer is the straight-line fallback and no third-party
 * router decides whether this suite is green. The first test drives that real
 * round trip end to end. The states a fallback cannot produce -- a preference
 * that chose between routes, and a road network that offered only one -- are
 * driven by answering `/api/route` in the browser with the body shape the
 * server returns.
 */

const planButton = (page: Page) => page.getByRole('button', { name: /plan a safer route/i });

/** The result's own sentence about the preference -- not the picker's copy. */
const outcome = (page: Page) => page.locator('.route-profile-result > p.hint');

test('a #/route?profile= link opens on that preference, and the real server is asked for it', async ({
  page,
}) => {
  await page.goto('/#/route?profile=e-bike');
  await expect(page.getByRole('radio', { name: 'E-bike' })).toBeChecked();

  const responded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/route');
  await planButton(page).click();
  const response = await responded;
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).searchParams.get('profile')).toBe('e-bike');

  // What the server measured, read from the body, so the assertions below are
  // about the page saying what the server said rather than about a branch.
  const { plan } = (await response.json()) as {
    plan: { source: string; profile: string; profileApplied: boolean | null };
  };
  expect(plan).toMatchObject({ source: 'fallback', profile: 'e-bike', profileApplied: null });
  await expect(outcome(page)).toHaveText(
    'The E-bike preference did not choose this: it is a direct line, not a route search.',
  );
  await expect(page.getByText('Chosen with the', { exact: false })).toHaveCount(0);
});

test('choosing a preference writes the permalink, and the keyboard can choose it', async ({
  page,
  context,
}) => {
  await page.goto('/#/route');
  const standard = page.getByRole('radio', { name: 'Standard' });
  const family = page.getByRole('radio', { name: 'Family / cargo bike' });
  await expect(standard).toBeChecked();

  // A native radio group, so the arrow keys move the selection.
  await standard.focus();
  await page.keyboard.press('ArrowDown');
  await expect(family).toBeChecked();
  await expect(page).toHaveURL(/#\/route\?profile=family-safest$/);

  // A copied link reopens on the same preference.
  const shared = await context.newPage();
  await shared.goto(page.url());
  await expect(shared.getByRole('radio', { name: 'Family / cargo bike' })).toBeChecked();
  await shared.close();

  // Back to Standard takes the parameter off, rather than writing the default
  // into every link.
  await standard.check();
  await expect(page).toHaveURL(/#\/route$/);

  // It is navigation state: the back button returns to the previous preference.
  await page.goBack();
  await expect(family).toBeChecked();
});

test('the result names the preference in each state a search can report, and says when it is stale', async ({
  page,
}) => {
  let next = stubRoutePlan({
    profile: 'family-safest',
    profileApplied: true,
    alternativesConsidered: 3,
  });
  const asked = await answerRoutesWith(page, () => next);
  await page.goto('/#/route?profile=family-safest');

  await planButton(page).click();
  await expect(outcome(page)).toHaveText('Chosen with the Family / cargo bike preference.');
  const weights = page.getByRole('list', { name: 'How Family / cargo bike weighs reported hazards:' });
  await expect(weights.getByRole('listitem')).toHaveCount(4);
  await expect(weights).toContainText('Dangerous intersection counts 2.5× as much as usual.');
  await expect(page.locator('#route-steps-profile')).toHaveText(
    'For the route the Family / cargo bike preference chose.',
  );

  // One route offered: the weights priced it, and chose nothing.
  next = stubRoutePlan({ profile: 'family-safest', profileApplied: false, alternativesConsidered: 1 });
  await planButton(page).click();
  await expect(outcome(page)).toContainText(
    'the road network offered only this one route, so the preference had nothing to choose between',
  );
  await expect(page.locator('#route-steps-profile')).toHaveText(
    'For the only route the road network offered; no preference chose between routes.',
  );

  // Switching after planning: the result keeps describing the plan on screen.
  await page.getByRole('radio', { name: 'E-bike' }).check();
  await expect(page.locator('.route-profile-stale')).toHaveText(
    'The route below was planned with the Family / cargo bike preference. You have chosen E-bike since: plan again to use it.',
  );
  await expect(outcome(page)).toContainText('Planned with the Family / cargo bike preference');

  expect(asked).toEqual(['family-safest', 'family-safest']);
});
