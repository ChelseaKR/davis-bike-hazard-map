/**
 * Geolocation wrapper. Auto-location is a convenience, never a requirement, so
 * every failure mode must reject with a typed, friendly GeolocationError that
 * the report form can fall back from to manual pin placement.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCurrentLocation, GeolocationError } from '../../src/lib/geolocation.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stub navigator.geolocation.getCurrentPosition with a scripted outcome. */
function stubGeolocation(
  impl: (success: PositionCallback, error: PositionErrorCallback) => void,
) {
  vi.stubGlobal('navigator', {
    geolocation: { getCurrentPosition: (s: PositionCallback, e: PositionErrorCallback) => impl(s, e) },
  });
}

const ERR = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };

describe('getCurrentLocation', () => {
  it('rejects with "unsupported" when the API is missing', async () => {
    vi.stubGlobal('navigator', {});
    await expect(getCurrentLocation()).rejects.toMatchObject({
      name: 'GeolocationError',
      code: 'unsupported',
    });
  });

  it('resolves to a {lat,lng} GeoPoint on success', async () => {
    stubGeolocation((success) =>
      success({ coords: { latitude: 38.5449, longitude: -121.741 } } as GeolocationPosition),
    );
    await expect(getCurrentLocation()).resolves.toEqual({ lat: 38.5449, lng: -121.741 });
  });

  it('maps PERMISSION_DENIED to a "denied" error', async () => {
    stubGeolocation((_s, error) =>
      error({ ...ERR, code: ERR.PERMISSION_DENIED, message: 'no' } as GeolocationPositionError),
    );
    await expect(getCurrentLocation()).rejects.toBeInstanceOf(GeolocationError);
    await expect(getCurrentLocation()).rejects.toMatchObject({ code: 'denied' });
  });

  it('maps TIMEOUT to a "timeout" error', async () => {
    stubGeolocation((_s, error) =>
      error({ ...ERR, code: ERR.TIMEOUT, message: '' } as GeolocationPositionError),
    );
    // Empty message falls back to the friendly default.
    await expect(getCurrentLocation()).rejects.toMatchObject({
      code: 'timeout',
      message: 'Could not get location.',
    });
  });

  it('maps any other code to "unavailable"', async () => {
    stubGeolocation((_s, error) =>
      error({ ...ERR, code: ERR.POSITION_UNAVAILABLE, message: 'no fix' } as GeolocationPositionError),
    );
    await expect(getCurrentLocation()).rejects.toMatchObject({
      code: 'unavailable',
      message: 'no fix',
    });
  });
});
