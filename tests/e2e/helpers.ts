import type { APIRequestContext, Page } from '@playwright/test';

export const MOD_TOKEN = 'e2e-token';

/** Approve the oldest pending hazard via the moderation API; returns its id. */
export async function approveOldestPending(request: APIRequestContext): Promise<string> {
  const queueRes = await request.get('/api/moderation/queue', {
    headers: { authorization: `Bearer ${MOD_TOKEN}` },
  });
  const { hazards } = await queueRes.json();
  if (!hazards.length) throw new Error('no pending hazards to approve');
  const id = hazards[0].id as string;
  await request.post(`/api/moderation/${id}`, {
    headers: { authorization: `Bearer ${MOD_TOKEN}`, 'content-type': 'application/json' },
    data: { decision: 'approve' },
  });
  return id;
}

/** Switch the app to a given tab by its visible label. */
export async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}
