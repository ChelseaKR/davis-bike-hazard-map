import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncOnce, startSync, MAX_SYNC_ATTEMPTS } from '../../src/lib/sync.ts';
import { ApiRequestError } from '../../src/lib/api.ts';
import type { QueuedReport } from '../../src/lib/db.ts';
import type { Hazard, ReportSubmission } from '../../shared/types.ts';

// startSync drains the real queue via these; mock them so the loop touches
// neither IndexedDB nor the network. (The syncOnce tests below inject deps and
// never reach this module.)
vi.mock('../../src/lib/db.ts', () => ({
  getPendingReports: vi.fn(),
  updateReport: vi.fn(),
}));
import * as db from '../../src/lib/db.ts';

function queued(over: Partial<QueuedReport> = {}): QueuedReport {
  const submission: ReportSubmission = {
    category: 'pothole',
    severity: 'high',
    location: { lat: 38.5449, lng: -121.7405 },
    photo: null,
    clientId: over.clientId ?? 'c1',
    capturedAt: 1,
  };
  return {
    clientId: over.clientId ?? 'c1',
    submission,
    state: 'queued',
    attempts: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const fakeHazard = { id: 'server-1' } as Hazard;

describe('syncOnce', () => {
  it('marks a report synced and stores the server id on success', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockResolvedValue({ hazard: fakeHazard });
    const result = await syncOnce({
      getPending: async () => [queued()],
      update,
      submit,
    });
    expect(result).toEqual({ attempted: 1, synced: 1, failed: 0 });
    expect(update).toHaveBeenCalledWith('c1', { state: 'syncing' });
    expect(update).toHaveBeenCalledWith('c1', { state: 'synced', serverId: 'server-1' });
  });

  it('keeps a report queued after a transient (network) failure', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await syncOnce({
      getPending: async () => [queued()],
      update,
      submit,
    });
    expect(result.failed).toBe(1);
    expect(update).toHaveBeenLastCalledWith('c1', {
      state: 'queued',
      attempts: 1,
      lastError: 'network down',
    });
  });

  it('errors out permanently on a 4xx (non-429) rejection', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockRejectedValue(new ApiRequestError('bad', 400));
    await syncOnce({ getPending: async () => [queued()], update, submit });
    expect(update).toHaveBeenLastCalledWith('c1', {
      state: 'error',
      attempts: 1,
      lastError: 'bad',
    });
  });

  it('treats 429 as transient', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockRejectedValue(new ApiRequestError('slow down', 429));
    await syncOnce({ getPending: async () => [queued()], update, submit });
    expect(update).toHaveBeenLastCalledWith('c1', {
      state: 'queued',
      attempts: 1,
      lastError: 'slow down',
    });
  });

  it('gives up after MAX_SYNC_ATTEMPTS', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockRejectedValue(new Error('still down'));
    await syncOnce({
      getPending: async () => [queued({ attempts: MAX_SYNC_ATTEMPTS - 1 })],
      update,
      submit,
    });
    expect(update).toHaveBeenLastCalledWith('c1', {
      state: 'error',
      attempts: MAX_SYNC_ATTEMPTS,
      lastError: 'still down',
    });
  });

  it('reports zero attempted for an empty queue', async () => {
    const result = await syncOnce({
      getPending: async () => [],
      update: vi.fn(),
      submit: vi.fn(),
    });
    expect(result).toEqual({ attempted: 0, synced: 0, failed: 0 });
  });
});

describe('startSync', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    // The loop calls the (mocked) db getter; return an empty queue so it's a
    // no-op that still records the call.
    vi.mocked(db.getPendingReports).mockReset().mockResolvedValue([]);
    vi.mocked(db.updateReport).mockReset().mockResolvedValue(undefined);
  });

  it('drains the queue once immediately on start', async () => {
    const stop = startSync();
    // Let the immediate tick's microtasks settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(db.getPendingReports).toHaveBeenCalled();
    stop();
  });

  it('drains again when the app returns to the foreground', async () => {
    const stop = startSync();
    await Promise.resolve();
    vi.mocked(db.getPendingReports).mockClear();

    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(db.getPendingReports).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops listening after the disposer runs', async () => {
    const stop = startSync();
    await Promise.resolve();
    stop();
    vi.mocked(db.getPendingReports).mockClear();

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(db.getPendingReports).not.toHaveBeenCalled();
  });

  it('skips error records automatically but syncOnce permits a manual retry', async () => {
    const errored = queued({ state: 'error', attempts: MAX_SYNC_ATTEMPTS });
    vi.mocked(db.getPendingReports).mockResolvedValue([errored]);
    const onResult = vi.fn();
    const stop = startSync(onResult);
    await Promise.resolve();
    await Promise.resolve();
    expect(db.updateReport).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    stop();

    const update = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockResolvedValue({ hazard: fakeHazard });
    const result = await syncOnce({
      getPending: async () => [errored],
      update,
      submit,
    });
    expect(result).toEqual({ attempted: 1, synced: 1, failed: 0 });
    expect(submit).toHaveBeenCalledOnce();
  });
});
