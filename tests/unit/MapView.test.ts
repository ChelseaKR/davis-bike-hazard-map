/**
 * MapView's Leaflet view-glue is exercised end-to-end by Playwright (real
 * browser layout — see vite.config.ts's coverage `exclude` comment for why it
 * isn't jsdom-covered generally). `buildPopup`, though, is pure DOM-building
 * logic with no dependency on layout/rendering, so it's exported specifically
 * to unit-test the "Demo data" marker (issue #111) without a real map.
 */
import { describe, it, expect } from 'vitest';
import { createIntl, createIntlCache } from 'react-intl';
import { buildPopup } from '../../src/components/MapView.tsx';
import type { Hazard } from '../../shared/types.ts';
import { DEFAULT_LOCALE, loadMessages } from '../../src/i18n/config.ts';

const cache = createIntlCache();
const intl = createIntl(
  { locale: DEFAULT_LOCALE, defaultLocale: DEFAULT_LOCALE, messages: loadMessages(DEFAULT_LOCALE) },
  cache,
);

const NOW = 1_700_000_000_000;

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
    category: 'pothole',
    severity: 'high',
    description: 'Deep pothole',
    location: { lat: 38.5449, lng: -121.7405 },
    photoUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: NOW - 5000,
    updatedAt: NOW - 5000,
    expiresAt: NOW + 1_000_000,
    ...over,
  };
}

describe('MapView popup demo-data marker (issue #111)', () => {
  it('marks a seeded hazard\'s popup as "Demo data" and swaps the note', () => {
    const el = buildPopup(hazard({ source: 'seed' }), intl);
    expect(el.querySelector('.map-popup-demo')?.textContent).toBe('Demo data');
    expect(el.querySelector('.map-popup-note')?.textContent).toMatch(
      /demo data.*fictional example, not a real report/i,
    );
    expect(el.textContent).not.toMatch(/community-reported/i);
  });

  it('does NOT mark a real report\'s popup as demo data', () => {
    const el = buildPopup(hazard({ source: 'report' }), intl);
    expect(el.querySelector('.map-popup-demo')).toBeNull();
    expect(el.querySelector('.map-popup-note')?.textContent).toMatch(/not verified by the city/i);
  });

  it('does NOT mark a popup as demo data when source is unset (legacy data)', () => {
    const el = buildPopup(hazard(), intl);
    expect(el.querySelector('.map-popup-demo')).toBeNull();
  });
});
