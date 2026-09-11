import { expect, type APIRequestContext, type Page } from '@playwright/test';

// Bootstrap moderator credentials the e2e server is started with (playwright.config).
export const MOD_USER = 'e2e';
export const MOD_PASS = 'e2e-password';

interface QueueHazard {
  id: string;
  description: string | null;
}

/** Sign in as the e2e moderator and return a session bearer token. */
async function moderatorToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    headers: { 'content-type': 'application/json' },
    data: { username: MOD_USER, password: MOD_PASS },
  });
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** Fetch the moderation queue (returns [] on any non-OK response). */
async function fetchQueue(request: APIRequestContext, token: string): Promise<QueueHazard[]> {
  const res = await request.get('/api/moderation/queue', {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok()) return [];
  const body = (await res.json()) as { hazards?: QueueHazard[] };
  return body.hazards ?? [];
}

/**
 * Poll until a pending hazard with the given description exists (the client
 * sync is asynchronous), then approve it. Returns the approved hazard id.
 */
export async function waitAndApprove(
  request: APIRequestContext,
  description: string,
): Promise<string> {
  const token = await moderatorToken(request);
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        id = (await fetchQueue(request, token)).find((h) => h.description === description)?.id;
        return Boolean(id);
      },
      { timeout: 15_000, intervals: [300, 600, 1000] },
    )
    .toBe(true);

  await request.post(`/api/moderation/${id}`, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: { decision: 'approve' },
  });
  return id!;
}

/** Switch the app to a given tab by its visible label. */
export async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}

// Synthetic coordinates only -- no real location in any fixture (DEFINITION_OF_DONE.md).
const STUB_FROM = { lat: 38.5449, lng: -121.7405 };
const STUB_TO = { lat: 38.5382, lng: -121.7617 };

/**
 * A `/api/route` response body, for the states the harness's own router cannot
 * produce. The e2e server runs with ROUTING_URL empty (playwright.config.ts), so
 * a real request only ever gets the straight-line fallback. A spec that needs a
 * preference that chose between routes, or a road network that offered only one,
 * answers `/api/route` in the browser with this -- the same body shape the server
 * returns.
 */
export function stubRoutePlan(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'osrm',
    from: STUB_FROM,
    to: STUB_TO,
    route: {
      geometry: [STUB_FROM, STUB_TO],
      distanceMeters: 2300,
      durationSeconds: 540,
      steps: [
        { instruction: 'Head out on A St', distanceMeters: 1200, location: STUB_FROM },
        { instruction: 'Arrive at your destination', distanceMeters: 0, location: STUB_TO },
      ],
    },
    nearby: [],
    alternativesConsidered: 3,
    hazardFreeCandidate: true,
    fastestAlternative: null,
    profile: 'default',
    profileApplied: true,
    ...over,
  };
}

/** One hazard on a stubbed route, so the result has a hazard list to read and scan. */
export function stubNearbyHazard(): Record<string, unknown> {
  return {
    hazard: {
      id: 'e2e-route-hazard',
      category: 'dangerous_intersection',
      severity: 'high',
      description: null,
      location: STUB_FROM,
      photoUrl: null,
      status: 'approved',
      confirmations: 0,
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 9e15,
      source: 'report',
    },
    distanceMeters: 12,
    penalty: 1850,
  };
}

/**
 * Answer every `/api/route` request in the browser with `next()`, and return the
 * `profile` parameter each request carried, in order (null when it carried none).
 */
export async function answerRoutesWith(
  page: Page,
  next: () => Record<string, unknown>,
): Promise<(string | null)[]> {
  const asked: (string | null)[] = [];
  await page.route(
    (url) => url.pathname === '/api/route',
    async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get('profile'));
      await route.fulfill({ json: { plan: next() } });
    },
  );
  return asked;
}

/**
 * Report a hazard at `location`, approve it, and return its id.
 *
 * The trends table and the coverage tally only exist once something has been
 * reported, so a spec that scans either has to put a report in the store first --
 * this suite shares one in-memory store, and a spec that ran before any other had
 * an empty one (the first run of the trends accessibility scan found no table).
 */
export async function seedApprovedHazard(
  request: APIRequestContext,
  location: { lat: number; lng: number },
  description: string,
  category = 'surface_damage',
): Promise<string> {
  const created = await request.post('/api/reports', {
    headers: { 'content-type': 'application/json' },
    data: {
      category,
      severity: 'moderate',
      description,
      location,
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
  const decided = await request.post(`/api/moderation/${hazard.id}`, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: { decision: 'approve' },
  });
  expect(decided.status()).toBe(200);
  return hazard.id;
}
