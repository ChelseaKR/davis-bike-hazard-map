import { describe, it, expect, vi } from 'vitest';
import { buildPayload, forwardToGogov, fetchGogovStatus } from '../../server/lib/gogov.ts';
import type { StoredHazard } from '../../server/lib/types.ts';

function stored(): StoredHazard {
  return {
    id: 'haz-1',
    clientId: 'c1',
    category: 'pothole',
    severity: 'high',
    description: 'Deep pothole',
    preciseLocation: { lat: 38.5449, lng: -121.7405 },
    publicLocation: { lat: 38.545, lng: -121.74 },
    photo: null,
    status: 'approved',
    confirmations: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    expiresAt: 1_800_000_000_000,
    moderation: [],
  };
}

describe('buildPayload', () => {
  it('uses the precise location and human-readable labels', () => {
    const payload = buildPayload(stored());
    expect(payload.location).toEqual({ lat: 38.5449, lng: -121.7405 });
    expect(payload.category).toBe('Pothole');
    expect(payload.severity).toBe('High');
    expect(payload.reference).toBe('haz-1');
    expect(payload.source).toBe('davis-bike-hazard-map');
  });
});

describe('forwardToGogov', () => {
  it('runs in dry-run with no webhook configured', async () => {
    const result = await forwardToGogov(stored(), { webhookUrl: '', apiKey: '' });
    expect(result.dryRun).toBe(true);
    expect(result.delivered).toBe(false);
  });

  it('POSTs to the webhook and reports delivery on 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 } as Response);
    const result = await forwardToGogov(
      stored(),
      { webhookUrl: 'https://311.example/api', apiKey: 'k' },
      fetchMock,
    );
    expect(result.delivered).toBe(true);
    expect(result.status).toBe(202);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://311.example/api');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer k' });
  });

  it('degrades gracefully (never throws) when the webhook errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connreset'));
    const result = await forwardToGogov(
      stored(),
      { webhookUrl: 'https://311.example/api', apiKey: '' },
      fetchMock,
    );
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('connreset');
  });

  it('reports non-2xx as undelivered', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const result = await forwardToGogov(
      stored(),
      { webhookUrl: 'https://311.example/api', apiKey: '' },
      fetchMock,
    );
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('500');
  });
});

describe('fetchGogovStatus', () => {
  it('dry-runs (no network) when no statusUrl is configured', async () => {
    const fetchMock = vi.fn();
    const res = await fetchGogovStatus('haz-1', { webhookUrl: '', apiKey: '' }, fetchMock);
    expect(res.dryRun).toBe(true);
    expect(res.status).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GETs {statusUrl}/{reference} and returns the status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'In Progress', note: 'crew assigned' }),
    } as Response);
    const res = await fetchGogovStatus(
      'haz-1',
      { webhookUrl: '', apiKey: 'k', statusUrl: 'https://311.example/status' },
      fetchMock,
    );
    expect(res.dryRun).toBe(false);
    expect(res.status).toBe('In Progress');
    expect(res.note).toBe('crew assigned');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://311.example/status/haz-1');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer k' });
  });

  it('reports an error (never throws) on a non-2xx or network failure', async () => {
    const bad = await fetchGogovStatus(
      'haz-1',
      { webhookUrl: '', apiKey: '', statusUrl: 'https://311.example/status' },
      vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response),
    );
    expect(bad.error).toContain('404');

    const thrown = await fetchGogovStatus(
      'haz-1',
      { webhookUrl: '', apiKey: '', statusUrl: 'https://311.example/status' },
      vi.fn().mockRejectedValue(new Error('timeout')),
    );
    expect(thrown.error).toContain('timeout');
  });
});
