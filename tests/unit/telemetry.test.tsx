import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  reportError,
  resetTelemetryForTest,
  installGlobalErrorHandlers,
} from '../../src/lib/telemetry.ts';

describe('reportError', () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetTelemetryForTest();
    beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('beacons a privacy-safe payload to the client-errors endpoint', () => {
    reportError(new Error('boom'), { source: 'window.onerror', detail: 'x' });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toMatch(/\/client-errors$/);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('stringifies non-Error values without throwing', () => {
    expect(() => reportError('plain string', { source: 's' })).not.toThrow();
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('caps reports per session to avoid error storms', () => {
    for (let i = 0; i < 40; i++) {
      reportError(new Error(`e${i}`), { source: 'loop' });
    }
    // Capped at 25 per session.
    expect(beacon).toHaveBeenCalledTimes(25);
  });
});

describe('reportError without sendBeacon', () => {
  beforeEach(() => {
    resetTelemetryForTest();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to fetch with keepalive when sendBeacon is unavailable', () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {}); // no sendBeacon
    vi.stubGlobal('fetch', fetchMock);

    reportError(new Error('boom'), { source: 'manual' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/client-errors$/);
    expect(opts.method).toBe('POST');
    expect(opts.keepalive).toBe(true);
    expect(opts.headers['content-type']).toBe('application/json');
    // Privacy: payload carries no query string, only the path.
    expect(JSON.parse(opts.body).path).not.toContain('?');
  });

  it('swallows a transport that has neither sendBeacon nor fetch (never throws)', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', undefined);
    expect(() => reportError(new Error('x'), { source: 's' })).not.toThrow();
  });
});

describe('installGlobalErrorHandlers', () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetTelemetryForTest();
    beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports uncaught errors and unhandled rejections, and detaches on dispose', () => {
    // Capture the registered handlers and invoke them directly, rather than
    // dispatching real global events (which Vitest's own runner would also
    // catch and flag as unhandled).
    const handlers: Record<string, EventListener> = {};
    vi.spyOn(window, 'addEventListener').mockImplementation((type, h) => {
      handlers[type as string] = h as EventListener;
    });
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const dispose = installGlobalErrorHandlers();

    handlers.error({ error: new Error('uncaught') } as unknown as Event);
    expect(beacon).toHaveBeenCalledTimes(1);

    handlers.unhandledrejection({ reason: new Error('rejected') } as unknown as Event);
    expect(beacon).toHaveBeenCalledTimes(2);

    dispose();
    expect(removeSpy).toHaveBeenCalledTimes(2);
  });
});
