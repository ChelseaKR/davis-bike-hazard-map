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
