/**
 * MapView's Leaflet view-glue is exercised end-to-end by Playwright (real
 * browser layout — see vite.config.ts's coverage `exclude` comment for why it
 * isn't jsdom-covered generally). `buildPopup`, though, is pure DOM-building
 * logic with no dependency on layout/rendering, so it's exported specifically
 * to unit-test the "Demo data" marker (issue #111) without a real map.
 */
import { describe, it, expect, vi } from 'vitest';
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

describe('MapView popup confirm button (#177)', () => {
  function clickConfirm(el: HTMLElement): HTMLButtonElement {
    const btn = el.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toMatch(/i saw this too/i);
    btn.click();
    return btn;
  }

  it('says the confirmation counted', async () => {
    const el = buildPopup(hazard(), intl, vi.fn().mockResolvedValue(true), NOW);
    clickConfirm(el);
    await vi.waitFor(() => {
      expect(el.querySelector('.hazard-confirm-note')?.textContent).toMatch(/counted/i);
    });
  });

  it('says the count stays put when this device already confirmed it', async () => {
    // The map popup is the primary confirm surface. Confirmations count once per
    // device, so a repeat tap here moves no number — and a control that appears
    // to do nothing is one a rider presses again.
    const el = buildPopup(hazard(), intl, vi.fn().mockResolvedValue(false), NOW);
    clickConfirm(el);
    await vi.waitFor(() => {
      const note = el.querySelector('.hazard-confirm-note');
      expect(note?.textContent).toMatch(/already confirmed this one/i);
      expect(note?.getAttribute('role')).toBe('status');
    });
    // The button is gone, so the dead control cannot be pressed again.
    expect(el.querySelector('button')).toBeNull();
  });

  it('claims NOTHING and keeps the button when the caller reports no outcome', async () => {
    // `undefined` is what App returns on a network error. Rendering "counted"
    // from it would assert a result nothing verified, and removing the button
    // would strand a rider whose request simply failed.
    const onConfirm = vi.fn();
    const el = buildPopup(hazard(), intl, onConfirm, NOW);
    clickConfirm(el);
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith('h1'));
    expect(el.querySelector('.hazard-confirm-note')).toBeNull();
    expect(el.querySelector('button')).not.toBeNull();
  });
});
