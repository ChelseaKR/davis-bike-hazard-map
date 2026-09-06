/**
 * Thin promise wrapper around the Geolocation API with friendly errors.
 *
 * Auto-location is a convenience, never a requirement — the report form always
 * lets the user place the pin by hand (accessibility + the no-GPS case).
 *
 * WHY THIS THROWS A CODE AND NOT A SENTENCE (issue #173). A thrown `Error`
 * carries a string, and this module has no `intl` — so any human-readable text
 * put in it is English that no catalog can reach. `RoutePlanner` used to
 * interpolate `err.message` straight into the catalogued `{reason}` slot of
 * `route.error.location`, which meant the wrapper was translated and the
 * payload was not: under an activated Spanish catalog a rider would get half a
 * translated sentence. So the error carries only `code`, and the component that
 * displays it resolves that code through `geolocationErrorLabel()` in
 * `src/i18n/labels.ts`.
 *
 * The browser's own `GeolocationPositionError.message` is deliberately dropped
 * for display for the same reason: it is vendor-supplied English, it varies by
 * engine, and it is not in any catalog. It is preserved as `cause` so it still
 * reaches a diagnostic.
 */
import type { GeoPoint } from '../../shared/types.ts';

/** Why locating failed. This, not prose, is what crosses the module boundary. */
export type GeolocationFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export class GeolocationError extends Error {
  constructor(
    readonly code: GeolocationFailure,
    options?: ErrorOptions,
  ) {
    // The machine code IS the message: it is a diagnostic, never display text.
    super(code, options);
    this.name = 'GeolocationError';
  }
}

export function getCurrentLocation(timeoutMs = 10_000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeolocationError('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const code: GeolocationFailure =
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable';
        reject(new GeolocationError(code, { cause: err }));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
