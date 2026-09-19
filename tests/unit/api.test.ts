import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildHazardQuery,
  fetchHazards,
  submitReport,
  confirmHazard,
  fetchRoute,
  subscribeAlert,
  unsubscribeAlert,
  fetchModerationQueue,
  decideModeration,
  login,
  deleteReport,
  ApiRequestError,
} from '../../src/lib/api.ts';
import type { ReportSubmission } from '../../shared/types.ts';
import type { Watch } from '../../shared/alerts.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('buildHazardQuery', () => {
  it('returns empty string for no filters', () => {
    expect(buildHazardQuery()).toBe('');
    expect(buildHazardQuery({})).toBe('');
  });
  it('serializes categories, severity, recency', () => {
    const qs = buildHazardQuery({
      categories: ['pothole', 'glass_debris'],
      minSeverity: 'high',
      withinDays: 7,
    });
    expect(qs).toContain('categories=pothole%2Cglass_debris');
    expect(qs).toContain('minSeverity=high');
    expect(qs).toContain('withinDays=7');
  });
});

describe('fetchHazards', () => {
  it('returns the hazard feed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hazards: [{ id: 'h1' }] })));
    const feed = await fetchHazards();
    expect(feed.hazards).toEqual([{ id: 'h1' }]);
  });
});

describe('submitReport', () => {
  const submission: ReportSubmission = {
    category: 'pothole',
    severity: 'high',
    location: { lat: 38.5449, lng: -121.7405 },
    photo: null,
    clientId: '11111111-1111-4111-8111-111111111111',
    capturedAt: 1,
  };

  it('POSTs the submission and returns the hazard', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hazard: { id: 'h1' } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const out = await submitReport(submission);
    expect(out.hazard.id).toBe('h1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws ApiRequestError with the server message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'validation_error', message: 'Outside Davis.' }, 400),
      ),
    );
    await expect(submitReport(submission)).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 400,
      message: 'Outside Davis.',
    });
  });
});

describe('confirmHazard', () => {
  it('POSTs to the confirm endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hazard: { id: 'h1' }, counted: true }));
    vi.stubGlobal('fetch', fetchMock);
    await confirmHazard('h1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/hazards/h1/confirm',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends the device id, and the SAME one on every call (#177)', async () => {
    // Found by a negative control: swapping `getDeviceId()` for a fresh UUID per
    // call left every other test green. The server would still see a valid id,
    // the cap would see a new device each tap, and it would suppress nothing
    // while reading as if it worked. Nothing else in the suite can catch that,
    // because the value is only wrong in its *stability*.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hazard: { id: 'h1' }, counted: true }));
    vi.stubGlobal('fetch', fetchMock);
    await confirmHazard('h1');
    await confirmHazard('h2');
    const bodies = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string) as { deviceId: string },
    );
    expect(bodies[0].deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(bodies[1].deviceId).toBe(bodies[0].deviceId);
  });

  it('returns whether the confirmation counted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hazard: { id: 'h1' }, counted: false }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await confirmHazard('h1')).counted).toBe(false);
  });
});

describe('login + deleteReport', () => {
  it('logs in and returns the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ token: 't', username: 'mod', expiresAt: 9 }));
    vi.stubGlobal('fetch', fetchMock);
    const session = await login('mod', 'pw');
    expect(session.token).toBe('t');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/login');
  });

  it('deletes a report and treats 404 as already gone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response));
    await expect(deleteReport('cid')).resolves.toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'not_found', message: 'gone' }, 404)));
    await expect(deleteReport('cid')).resolves.toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'boom', message: 'server' }, 500)));
    await expect(deleteReport('cid')).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('fetchRoute', () => {
  it('encodes from/to as lat,lng query params and returns the plan', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ plan: { source: 'osrm' } }));
    vi.stubGlobal('fetch', fetchMock);
    const plan = await fetchRoute({ lat: 38.54, lng: -121.74 }, { lat: 38.55, lng: -121.73 });
    expect(plan).toEqual({ source: 'osrm' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/route?from=38.54,-121.74&to=38.55,-121.73');
  });

  it('sends a non-default rider preference, and leaves the default off the URL (issue #178)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ plan: { source: 'osrm' } }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchRoute({ lat: 38.54, lng: -121.74 }, { lat: 38.55, lng: -121.73 }, 'family-safest');
    await fetchRoute({ lat: 38.54, lng: -121.74 }, { lat: 38.55, lng: -121.73 }, 'default');
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/route?from=38.54,-121.74&to=38.55,-121.73&profile=family-safest',
    );
    // Identical to a request made before profiles existed, so the service
    // worker's cached plan for it is still the one that answers offline.
    expect(fetchMock.mock.calls[1][0]).toBe('/api/route?from=38.54,-121.74&to=38.55,-121.73');
  });
});

describe('alerts api', () => {
  const watch: Watch = { kind: 'area', minLat: 38.5, minLng: -121.8, maxLat: 38.6, maxLng: -121.7 };

  it('POSTs a subscription and returns the id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'sub-1' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const out = await subscribeAlert(
      { endpoint: 'https://push/x', keys: { p256dh: 'p', auth: 'a' } },
      watch,
      'commute',
    );
    expect(out.id).toBe('sub-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/alerts/subscribe');
    expect(JSON.parse(init.body).label).toBe('commute');
  });

  it('DELETEs a subscription and treats 404 as already gone', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
    vi.stubGlobal('fetch', ok);
    await expect(unsubscribeAlert('sub-1')).resolves.toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'not_found', message: 'gone' }, 404)),
    );
    await expect(unsubscribeAlert('sub-1')).resolves.toBeUndefined();
  });
});

describe('moderation api', () => {
  it('sends the bearer token on the queue request', async () => {
    const page = { hazards: [], nextCursor: null, total: 0 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchModerationQueue('secret')).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/moderation/queue',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      }),
    );
  });

  it('URL-encodes the page cursor on follow-up queue requests (FIX-04)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ hazards: [], nextCursor: null, total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchModerationQueue('secret', '1700000000000:abc');
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/moderation/queue?cursor=1700000000000%3Aabc',
    );
  });

  it('sends the decision and token on a moderation call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hazard: { id: 'h1' } }));
    vi.stubGlobal('fetch', fetchMock);
    await decideModeration('h1', 'approve', 'secret', 'looks real');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ decision: 'approve', reason: 'looks real' });
  });
});

describe('ApiRequestError', () => {
  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response),
    );
    await expect(fetchHazards()).rejects.toBeInstanceOf(ApiRequestError);
  });
});
