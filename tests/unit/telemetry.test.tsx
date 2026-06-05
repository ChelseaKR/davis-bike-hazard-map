import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportError, resetTelemetryForTest } from '../../src/lib/telemetry.ts';

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
