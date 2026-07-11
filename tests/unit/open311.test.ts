import { describe, it, expect, vi } from 'vitest';
import { buildOpen311Request, submitOpen311Request, fetchOpen311Status } from '../../server/lib/open311.ts';
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

describe('buildOpen311Request', () => {
  it('maps a hazard onto GeoReport v2 fields using the precise location', () => {
    const request = buildOpen311Request(stored(), { serviceCode: 'bike-hazard', jurisdictionId: '', apiKey: '' });
    expect(request.service_code).toBe('bike-hazard');
    expect(request.lat).toBe(38.5449);
    expect(request.long).toBe(-121.7405);
    expect(request.description).toContain('Deep pothole');
    expect(request.description).toContain('High');
    expect(request.attribute).toContain('reference:haz-1');
    expect(request.jurisdiction_id).toBeUndefined();
    expect(request.api_key).toBeUndefined();
  });

  it('includes jurisdiction_id and api_key when configured', () => {
    const request = buildOpen311Request(stored(), {
      serviceCode: 'bike-hazard',
      jurisdictionId: 'davis.ca.us',
      apiKey: 'k',
    });
    expect(request.jurisdiction_id).toBe('davis.ca.us');
    expect(request.api_key).toBe('k');
  });

  it('falls back to a generated description when none was given', () => {
    const hazard = { ...stored(), description: null };
    const request = buildOpen311Request(hazard, { serviceCode: 'bike-hazard' });
    expect(request.description).toContain('Pothole reported by a cyclist.');
  });
});

describe('submitOpen311Request', () => {
  it('runs in dry-run with no endpoint configured', async () => {
    const result = await submitOpen311Request(stored(), {
      endpoint: '',
      serviceCode: 'bike-hazard',
    });
    expect(result.dryRun).toBe(true);
    expect(result.delivered).toBe(false);
    expect(result.request.service_code).toBe('bike-hazard');
  });

  it('POSTs a form-encoded request and reports delivery with the service_request_id on 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => [{ service_request_id: '638344', service_notice: 'thanks' }],
    } as Response);
    const result = await submitOpen311Request(
      stored(),
      { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard', apiKey: 'k', jurisdictionId: 'davis.ca.us' },
      fetchMock,
    );
    expect(result.delivered).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.serviceRequestId).toBe('638344');
    expect(result.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://311.example.gov/v2/requests.json');
    const req = init as RequestInit;
    expect(req.method).toBe('POST');
    expect((req.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(req.body as string);
    expect(body.get('service_code')).toBe('bike-hazard');
    expect(body.get('jurisdiction_id')).toBe('davis.ca.us');
    expect(body.get('api_key')).toBe('k');
    expect(body.getAll('attribute[]')).toContain('reference:haz-1');
  });

  it('never echoes api_key in the result, while still sending it on the wire', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => [{ service_request_id: '638344' }],
    } as Response);
    const config = { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard', apiKey: 'k' };
    const result = await submitOpen311Request(stored(), config, fetchMock);
    // The credential goes to the 311 server…
    const [, init] = fetchMock.mock.calls[0];
    expect(new URLSearchParams((init as RequestInit).body as string).get('api_key')).toBe('k');
    // …but never back to the caller (the hand-off route echoes this result to the moderator UI).
    expect(result.request.api_key).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('"k"');
    // Dry-run echoes are redacted the same way.
    const dry = await submitOpen311Request(stored(), { ...config, endpoint: '' });
    expect(dry.dryRun).toBe(true);
    expect(dry.request.api_key).toBeUndefined();
  });

  it('reports non-2xx as undelivered without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const result = await submitOpen311Request(
      stored(),
      { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard' },
      fetchMock,
    );
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('500');
  });

  it('reports a missing service_request_id as undelivered', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [{}] } as Response);
    const result = await submitOpen311Request(
      stored(),
      { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard' },
      fetchMock,
    );
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('service_request_id');
  });

  it('degrades gracefully (never throws) on a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connreset'));
    const result = await submitOpen311Request(
      stored(),
      { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard' },
      fetchMock,
    );
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('connreset');
  });
});

describe('fetchOpen311Status', () => {
  it('dry-runs (no network) when no endpoint is configured', async () => {
    const fetchMock = vi.fn();
    const res = await fetchOpen311Status('638344', { endpoint: '', serviceCode: 'bike-hazard' }, fetchMock);
    expect(res.dryRun).toBe(true);
    expect(res.status).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GETs {endpoint}/requests/{id}.json and returns the raw Open311 status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ status: 'open', status_notes: 'crew assigned' }],
    } as Response);
    const res = await fetchOpen311Status(
      '638344',
      { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard', apiKey: 'k', jurisdictionId: 'davis.ca.us' },
      fetchMock,
    );
    expect(res.dryRun).toBe(false);
    expect(res.status).toBe('open');
    expect(res.note).toBe('crew assigned');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://311.example.gov/v2/requests/638344.json?jurisdiction_id=davis.ca.us&api_key=k');
  });

  it('reports an error (never throws) on a non-2xx, missing status, or network failure', async () => {
    const badStatus = await fetchOpen311Status(
      '638344',
      { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard' },
      vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response),
    );
    expect(badStatus.error).toContain('404');

    const noStatus = await fetchOpen311Status(
      '638344',
      { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard' },
      vi.fn().mockResolvedValue({ ok: true, json: async () => [{}] } as Response),
    );
    expect(noStatus.error).toContain('status');

    const thrown = await fetchOpen311Status(
      '638344',
      { endpoint: 'https://311.example.gov/v2', serviceCode: 'bike-hazard' },
      vi.fn().mockRejectedValue(new Error('timeout')),
    );
    expect(thrown.error).toContain('timeout');
  });
});
