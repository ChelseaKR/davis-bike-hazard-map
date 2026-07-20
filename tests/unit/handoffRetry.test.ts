import { describe, it, expect, vi } from 'vitest';
import {
  MAX_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_MAX_DELAY_MS,
  receiptFor,
  retryDelayMs,
  sweepHandoffRetries,
} from '../../server/lib/handoffRetry.ts';
import type { HandoffProviderConfig } from '../../server/lib/handoff.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import type { HandoffDelivery, StoredHazard } from '../../server/lib/types.ts';

const NOW = 1_700_000_000_000;

function hazard(over: Partial<StoredHazard> = {}): StoredHazard {
  return {
    id: 'h1',
    clientId: 'c1',
    category: 'pothole',
    severity: 'high',
    description: 'Deep pothole',
    preciseLocation: { lat: 38.5449, lng: -121.7405 },
    publicLocation: { lat: 38.545, lng: -121.74 },
    photo: null,
    status: 'approved',
    confirmations: 0,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    moderation: [],
    ...over,
  };
}

function retrying(over: Partial<HandoffDelivery> = {}): HandoffDelivery {
  return {
    state: 'retrying',
    dryRun: false,
    attempts: 1,
    lastAttemptAt: NOW - RETRY_BASE_MS,
    nextRetryAt: NOW,
    lastError: '311 responded 502',
    ...over,
  };
}

/** Provider config pointing gogov at a live URL (so a transport really runs). */
const liveConfig: HandoffProviderConfig = {
  handoffProvider: 'gogov',
  gogov: { webhookUrl: 'https://gogov.example/webhook', apiKey: '' },
  open311: { endpoint: '', apiKey: '', jurisdictionId: '', serviceCode: '' },
};

const dryRunConfig: HandoffProviderConfig = {
  ...liveConfig,
  gogov: { webhookUrl: '', apiKey: '' },
};

const okFetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
const failFetch = (async () => ({ ok: false, status: 502 })) as unknown as typeof fetch;

describe('retryDelayMs', () => {
  it('doubles from the base and caps at the maximum', () => {
    expect(retryDelayMs(1)).toBe(RETRY_BASE_MS);
    expect(retryDelayMs(2)).toBe(2 * RETRY_BASE_MS);
    expect(retryDelayMs(3)).toBe(4 * RETRY_BASE_MS);
    expect(retryDelayMs(100)).toBe(RETRY_MAX_DELAY_MS);
  });
});

describe('receiptFor', () => {
  it('records a dry-run as submitted intent (nothing to retry)', () => {
    const r = receiptFor({ delivered: false, dryRun: true }, null, NOW);
    expect(r).toEqual({
      state: 'submitted',
      dryRun: true,
      attempts: 1,
      lastAttemptAt: NOW,
      nextRetryAt: null,
      lastError: null,
    });
  });

  it('records a delivered attempt as submitted and clears any prior error', () => {
    const r = receiptFor({ delivered: true, dryRun: false }, retrying({ attempts: 2 }), NOW);
    expect(r.state).toBe('submitted');
    expect(r.attempts).toBe(3);
    expect(r.lastError).toBeNull();
    expect(r.nextRetryAt).toBeNull();
  });

  it('schedules an exponential retry after a failure', () => {
    const first = receiptFor({ delivered: false, dryRun: false, error: 'boom' }, null, NOW);
    expect(first.state).toBe('retrying');
    expect(first.attempts).toBe(1);
    expect(first.nextRetryAt).toBe(NOW + RETRY_BASE_MS);
    expect(first.lastError).toBe('boom');

    const second = receiptFor({ delivered: false, dryRun: false, error: 'boom' }, first, NOW);
    expect(second.nextRetryAt).toBe(NOW + 2 * RETRY_BASE_MS);
  });

  it('dead-letters once the attempt budget is exhausted', () => {
    const prior = retrying({ attempts: MAX_ATTEMPTS - 1 });
    const r = receiptFor({ delivered: false, dryRun: false, error: 'still down' }, prior, NOW);
    expect(r.state).toBe('failed');
    expect(r.attempts).toBe(MAX_ATTEMPTS);
    expect(r.nextRetryAt).toBeNull();
  });
});

describe('sweepHandoffRetries', () => {
  it('re-forwards only due retries and marks recovered deliveries submitted', async () => {
    const repo = new MemoryRepository();
    await repo.insert(hazard({ id: 'due', clientId: 'c-due', handoffDelivery: retrying() }));
    await repo.insert(
      hazard({
        id: 'later',
        clientId: 'c-later',
        handoffDelivery: retrying({ nextRetryAt: NOW + 60_000 }),
      }),
    );

    const result = await sweepHandoffRetries(repo, liveConfig, okFetch, NOW);
    expect(result).toEqual({ attempted: 1, recovered: 1, rescheduled: 0, deadLettered: 0 });

    const due = (await repo.findById('due'))!;
    expect(due.handoffDelivery?.state).toBe('submitted');
    expect(due.handoff?.stage).toBe('submitted'); // refreshed submission record
    const later = (await repo.findById('later'))!;
    expect(later.handoffDelivery?.state).toBe('retrying'); // untouched
  });

  it('reschedules on repeated failure and reports it via the failure hook', async () => {
    const repo = new MemoryRepository();
    await repo.insert(hazard({ handoffDelivery: retrying() }));
    const onFail = vi.fn();

    const result = await sweepHandoffRetries(repo, liveConfig, failFetch, NOW, onFail);
    expect(result.rescheduled).toBe(1);
    expect(onFail).toHaveBeenCalledTimes(1);

    const h = (await repo.findById('h1'))!;
    expect(h.handoffDelivery?.state).toBe('retrying');
    expect(h.handoffDelivery?.attempts).toBe(2);
    expect(h.handoffDelivery?.nextRetryAt).toBe(NOW + 2 * RETRY_BASE_MS);
  });

  it('dead-letters a hand-off whose retry budget is spent', async () => {
    const repo = new MemoryRepository();
    await repo.insert(hazard({ handoffDelivery: retrying({ attempts: MAX_ATTEMPTS - 1 }) }));
    const onFail = vi.fn();

    const result = await sweepHandoffRetries(repo, liveConfig, failFetch, NOW, onFail);
    expect(result.deadLettered).toBe(1);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect((await repo.findById('h1'))!.handoffDelivery?.state).toBe('failed');
  });

  it('treats a provider unconfigured mid-flight as recovered intent (dry-run)', async () => {
    const repo = new MemoryRepository();
    await repo.insert(hazard({ handoffDelivery: retrying() }));
    const result = await sweepHandoffRetries(repo, dryRunConfig, failFetch, NOW);
    expect(result.recovered).toBe(1);
    const h = (await repo.findById('h1'))!;
    expect(h.handoffDelivery).toMatchObject({ state: 'submitted', dryRun: true });
  });
});
