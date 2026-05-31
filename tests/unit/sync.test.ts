import { describe, it, expect, vi } from 'vitest';
import { syncOnce, MAX_SYNC_ATTEMPTS } from '../../src/lib/sync.ts';
import { ApiRequestError } from '../../src/lib/api.ts';
import type { QueuedReport } from '../../src/lib/db.ts';
import type { Hazard, ReportSubmission } from '../../shared/types.ts';

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
