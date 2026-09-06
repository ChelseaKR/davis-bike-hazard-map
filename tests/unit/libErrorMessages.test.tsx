/**
 * Issue #173 — thrown `Error` text from `src/lib` must not reach the UI as
 * English.
 *
 * `geolocation.ts`, `push.ts` and `photo.ts` are framework-free, so they have
 * no `intl`, and a thrown `Error` carries a string rather than a message
 * descriptor. The result was a wrapper that was translated and a payload that
 * was not: `RoutePlanner` interpolated `err.message` — the browser's own
 * English, or ours — straight into the catalogued `{reason}` slot of
 * `route.error.location`. Under an activated Spanish catalog a rider would get
 * half a translated sentence.
 *
 * An English regex cannot catch that: the correct output and the defective
 * output are both English under the default catalog. Formatting under a
 * catalog whose values are SENTINELS can — anything that never reached the
 * catalog comes back as its English literal and fails. Same technique as
 * `reportTrail.test.ts`, which is what caught this class the first time.
 */
import { describe, it, expect } from 'vitest';
import { createIntl, IntlProvider, type IntlShape } from 'react-intl';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  geolocationErrorLabel,
  pushErrorLabel,
  photoErrorLabel,
} from '../../src/i18n/labels.ts';
import { GeolocationError, type GeolocationFailure } from '../../src/lib/geolocation.ts';
import { PushRegistrationError } from '../../src/lib/push.ts';
import { PhotoReadError, fileToDataUrl } from '../../src/lib/photo.ts';
import { RoutePlanner } from '../../src/components/RoutePlanner.tsx';

const SENTINELS = {
  'error.geolocation.unsupported': '⟦geo.unsupported⟧',
  'error.geolocation.denied': '⟦geo.denied⟧',
  'error.geolocation.unavailable': '⟦geo.unavailable⟧',
  'error.geolocation.timeout': '⟦geo.timeout⟧',
  'error.push.unsupported': '⟦push.unsupported⟧',
  'error.push.permissionNotGranted': '⟦push.permissionNotGranted⟧',
  'error.photo.unreadable': '⟦photo.unreadable⟧',
  'route.error.location': "⟦route.location⟧: {reason}",
} as const;

const sentinelIntl: IntlShape = createIntl({
  locale: 'en',
  defaultLocale: 'en',
  messages: SENTINELS,
});

const GEO_CODES: GeolocationFailure[] = ['unsupported', 'denied', 'unavailable', 'timeout'];

describe('src/lib failure codes resolve through the catalog (#173)', () => {
  it.each(GEO_CODES)('geolocation "%s" comes from the catalog, not the module', (code) => {
    expect(geolocationErrorLabel(sentinelIntl, code)).toBe(SENTINELS[`error.geolocation.${code}`]);
  });

  it('push failures come from the catalog', () => {
    expect(pushErrorLabel(sentinelIntl, 'unsupported')).toBe('⟦push.unsupported⟧');
    expect(pushErrorLabel(sentinelIntl, 'permissionNotGranted')).toBe(
      '⟦push.permissionNotGranted⟧',
    );
  });

  it('photo read failures come from the catalog', () => {
    expect(photoErrorLabel(sentinelIntl, 'unreadable')).toBe('⟦photo.unreadable⟧');
  });
});

describe('the errors themselves carry a code, not a sentence (#173)', () => {
  it('GeolocationError.message is the machine code', () => {
    const err = new GeolocationError('denied');
    expect(err.message).toBe('denied');
    expect(err.code).toBe('denied');
    // The thing that must never happen: prose on the wire.
    expect(err.message).not.toMatch(/\s/);
  });

  it('PushRegistrationError.message is the machine code', () => {
    const err = new PushRegistrationError('permissionNotGranted');
    expect(err.message).toBe('permissionNotGranted');
    expect(err.message).not.toMatch(/\s/);
  });

  it('PhotoReadError.message is the machine code, and keeps the DOM error as cause', () => {
    const domError = new DOMException('boom', 'NotReadableError');
    const err = new PhotoReadError('unreadable', { cause: domError });
    expect(err.message).toBe('unreadable');
    expect(err.cause).toBe(domError);
  });

  it('fileToDataUrl rejects with a PhotoReadError rather than an English Error', async () => {
    // A FileReader that always fails, so this stays a pure unit test.
    class FailingReader {
      error: DOMException | null = new DOMException('nope', 'NotReadableError');
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    const original = globalThis.FileReader;
    globalThis.FileReader = FailingReader as unknown as typeof FileReader;
    try {
      await expect(fileToDataUrl(new Blob(['x']))).rejects.toBeInstanceOf(PhotoReadError);
    } finally {
      globalThis.FileReader = original;
    }
  });
});

describe('RoutePlanner renders the reason through the catalog (#173)', () => {
  it('does not interpolate an untranslated payload into the translated wrapper', async () => {
    // jsdom has no navigator.geolocation, so the real module rejects with the
    // 'unsupported' code — no mock needed, and the real error contract is what
    // gets exercised.
    render(
      <IntlProvider locale="en" defaultLocale="en" messages={SENTINELS}>
        <RoutePlanner />
      </IntlProvider>,
    );

    await userEvent.click(screen.getAllByRole('button', { name: /my location/i })[0]);

    const alert = await screen.findByRole('alert');
    // Both halves of the sentence are catalog values. Before #173 the reason
    // half came back as the module's (or the browser's) English literal.
    expect(alert).toHaveTextContent('⟦route.location⟧');
    expect(alert).toHaveTextContent('⟦geo.unsupported⟧');
    expect(alert.textContent).not.toMatch(/geolocation is not supported/i);
  });
});
