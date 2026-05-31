import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const MOD_TOKEN = 'e2e-token';

interface QueueHazard {
  id: string;
  description: string | null;
}

/** Fetch the moderation queue (returns [] on any non-OK response). */
async function fetchQueue(request: APIRequestContext): Promise<QueueHazard[]> {
  const res = await request.get('/api/moderation/queue', {
    headers: { authorization: `Bearer ${MOD_TOKEN}` },
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
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        id = (await fetchQueue(request)).find((h) => h.description === description)?.id;
        return Boolean(id);
      },
      { timeout: 15_000, intervals: [300, 600, 1000] },
    )
    .toBe(true);

  await request.post(`/api/moderation/${id}`, {
    headers: { authorization: `Bearer ${MOD_TOKEN}`, 'content-type': 'application/json' },
    data: { decision: 'approve' },
  });
  return id!;
}

/** Switch the app to a given tab by its visible label. */
export async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}
