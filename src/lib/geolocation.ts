/**
 * Thin promise wrapper around the Geolocation API with friendly errors.
 *
 * Auto-location is a convenience, never a requirement — the report form always
 * lets the user place the pin by hand (accessibility + the no-GPS case).
 */
import type { GeoPoint } from '../../shared/types.ts';

export class GeolocationError extends Error {
  constructor(
    message: string,
    readonly code: 'unsupported' | 'denied' | 'unavailable' | 'timeout',
  ) {
    super(message);
    this.name = 'GeolocationError';
  }
}

export function getCurrentLocation(timeoutMs = 10_000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeolocationError('Geolocation is not supported.', 'unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const code =
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable';
        reject(new GeolocationError(err.message || 'Could not get location.', code));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
