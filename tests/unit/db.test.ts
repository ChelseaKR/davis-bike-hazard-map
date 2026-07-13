import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueReport,
  getPendingReports,
  getAllReports,
  getReport,
  updateReport,
  deleteReport,
  countByState,
  STALE_SYNCING_MS,
  _resetDbForTests,
} from '../../src/lib/db.ts';
import type { ReportSubmission } from '../../shared/types.ts';

function submission(id: string): ReportSubmission {
  return {
    category: 'pothole',
    severity: 'high',
    location: { lat: 38.5449, lng: -121.7405 },
    photo: null,
    clientId: id,
    capturedAt: Date.now(),
  };
}

beforeEach(async () => {
  await _resetDbForTests();
});

describe('offline report queue', () => {
  it('enqueues a report in the "queued" state', async () => {
    const rec = await enqueueReport(submission('a'));
    expect(rec.state).toBe('queued');
    expect(rec.attempts).toBe(0);
    expect(await getReport('a')).toBeDefined();
  });

  it('lists pending (queued/error) reports oldest first', async () => {
    await enqueueReport(submission('a'));
    await enqueueReport(submission('b'));
    await updateReport('b', { state: 'synced' });
    const pending = await getPendingReports();
    expect(pending.map((r) => r.clientId)).toEqual(['a']);
  });

  it('recovers a report stranded in "syncing" once it goes stale', async () => {
    await enqueueReport(submission('a'));
    await updateReport('a', { state: 'syncing' });
    // Freshly 'syncing' is presumed in flight, so it is not pending…
    expect((await getPendingReports()).map((r) => r.clientId)).toEqual([]);
    // …but once stuck past the staleness window (app killed mid-request, no
    // outcome recorded) it becomes retryable again.
    const later = Date.now() + STALE_SYNCING_MS + 1;
    expect((await getPendingReports(later)).map((r) => r.clientId)).toEqual(['a']);
  });

  it('updates state and records errors', async () => {
    await enqueueReport(submission('a'));
    const updated = await updateReport('a', { state: 'error', lastError: 'boom', attempts: 2 });
    expect(updated?.state).toBe('error');
    expect(updated?.lastError).toBe('boom');
  });

  it('returns undefined when updating a missing report', async () => {
    expect(await updateReport('missing', { state: 'synced' })).toBeUndefined();
  });

  it('deletes a report', async () => {
    await enqueueReport(submission('a'));
    await deleteReport('a');
    expect(await getReport('a')).toBeUndefined();
  });

  it('counts reports by state', async () => {
    await enqueueReport(submission('a'));
    await enqueueReport(submission('b'));
    await updateReport('b', { state: 'synced' });
    const counts = await countByState();
    expect(counts.queued).toBe(1);
    expect(counts.synced).toBe(1);
  });

  it('returns all reports newest first', async () => {
    await enqueueReport(submission('a'));
    await new Promise((r) => setTimeout(r, 2));
    await enqueueReport(submission('b'));
    const all = await getAllReports();
    expect(all[0].clientId).toBe('b');
  });
});
