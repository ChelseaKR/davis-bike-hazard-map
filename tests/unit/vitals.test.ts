import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Metric } from 'web-vitals';

// Capture the per-metric handlers so tests can feed synthetic metrics without
// a real browser performance timeline.
const handlers: Record<string, (metric: Metric) => void> = {};
vi.mock('web-vitals', () => ({
  onCLS: (cb: (metric: Metric) => void) => {
    handlers.CLS = cb;
  },
  onINP: (cb: (metric: Metric) => void) => {
    handlers.INP = cb;
  },
  onLCP: (cb: (metric: Metric) => void) => {
    handlers.LCP = cb;
  },
}));

import { reportWebVitals } from '../../src/lib/vitals.ts';

const fakeMetric = (overrides: Partial<Metric> = {}): Metric =>
  ({
    name: 'LCP',
    value: 1234.5678,
    rating: 'good',
    delta: 0,
    id: 'v4-test',
    entries: [],
    navigationType: 'navigate',
    ...overrides,
  }) as Metric;

describe('reportWebVitals', () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const key of Object.keys(handlers)) delete handlers[key];
    beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.stubGlobal('location', { pathname: '/map', search: '?secret=1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('subscribes to CLS, INP and LCP', () => {
    reportWebVitals();
    expect(Object.keys(handlers).sort()).toEqual(['CLS', 'INP', 'LCP']);
  });

  it('beacons a cookieless payload to the web-vitals endpoint', async () => {
    reportWebVitals();
    handlers.LCP(fakeMetric());

    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toMatch(/\/metrics\/web-vitals$/);
    expect(blob).toBeInstanceOf(Blob);

    // jsdom's Blob has no .text(); read it via FileReader.
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob as Blob);
    });
    const payload = JSON.parse(text);
    expect(payload).toEqual({
      type: 'vital',
      name: 'LCP',
      value: 1234.568, // rounded to 3 decimals
      rating: 'good',
      path: '/map',
    });
    // Privacy: only whitelisted fields, path without the query string.
    expect(Object.keys(payload).sort()).toEqual(['name', 'path', 'rating', 'type', 'value']);
    expect(payload.path).not.toContain('?');
  });

  it('falls back to fetch with keepalive when sendBeacon is unavailable', () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {}); // no sendBeacon
    vi.stubGlobal('fetch', fetchMock);

    reportWebVitals();
    handlers.CLS(fakeMetric({ name: 'CLS', value: 0.05, rating: 'good' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/metrics\/web-vitals$/);
    expect(opts.method).toBe('POST');
    expect(opts.keepalive).toBe(true);
    expect(opts.headers['content-type']).toBe('application/json');
    expect(JSON.parse(opts.body).name).toBe('CLS');
  });

  it('swallows transport failures (never throws)', () => {
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('beacon down');
      },
    });
    reportWebVitals();
    expect(() => handlers.INP(fakeMetric({ name: 'INP', value: 180, rating: 'good' }))).not.toThrow();
  });

  it('does nothing harmful when neither sendBeacon nor fetch exist', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', undefined);
    reportWebVitals();
    expect(() => handlers.LCP(fakeMetric())).not.toThrow();
  });
});
