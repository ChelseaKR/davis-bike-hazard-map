import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildHazardQuery,
  fetchHazards,
  submitReport,
  confirmHazard,
  fetchModerationQueue,
  decideModeration,
  ApiRequestError,
} from '../../src/lib/api.ts';
import type { ReportSubmission } from '../../shared/types.ts';

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
  it('returns the hazards array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hazards: [{ id: 'h1' }] })));
    const hazards = await fetchHazards();
    expect(hazards).toEqual([{ id: 'h1' }]);
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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hazard: { id: 'h1' } }));
    vi.stubGlobal('fetch', fetchMock);
    await confirmHazard('h1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/hazards/h1/confirm',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('moderation api', () => {
  it('sends the bearer token on the queue request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hazards: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchModerationQueue('secret');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/moderation/queue',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      }),
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
