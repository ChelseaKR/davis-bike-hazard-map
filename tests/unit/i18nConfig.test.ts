/**
 * Regression coverage for issue #112: locale negotiation must never select a
 * catalogued-but-untranslated locale. Before `ACTIVATED_LANGUAGES` existed,
 * `negotiate()` matched any locale with a JSON file — so an `es`-preferring
 * browser got `document.documentElement.lang = 'es'` (IntlProviderShell.tsx
 * keeps `<html lang>` in sync with the negotiated locale) while every string
 * on the page still rendered in English via the `defaultMessage` fallback,
 * because `es.json` is structure-only (0 of 214 values translated).
 *
 * These tests assert the mechanism directly (negotiate/isActivated/
 * isSupported), independent of whichever locales happen to be activated
 * today, so the suite still means something once `es` is genuinely promoted.
 */
import { describe, it, expect } from 'vitest';
import {
  ACTIVATED_LANGUAGES,
  DEFAULT_LOCALE,
  SUPPORTED_LANGUAGES,
  isActivated,
  isSupported,
  loadMessages,
  negotiate,
} from '../../src/i18n/config.ts';

describe('locale negotiation only ever activates real, translated locales', () => {
  it('es is catalogued (has a JSON file, participates in the gates) but not activated', () => {
    expect(isSupported('es')).toBe(true);
    expect(isActivated('es')).toBe(false);
  });

  it('negotiate() never returns a catalogued-but-unactivated locale, however strongly preferred', () => {
    expect(negotiate(['es'])).toBe('en');
    expect(negotiate(['es-MX', 'es'])).toBe('en');
    // A visitor whose only acceptable languages are all unactivated still gets
    // the site default, not a silently-wrong-language page.
    expect(negotiate(['es', 'es-419', 'es-ES'])).toBe(DEFAULT_LOCALE);
  });

  it('negotiate() still resolves an activated locale by RFC 4647 primary-subtag lookup', () => {
    expect(negotiate(['en-US', 'es'])).toBe('en');
    expect(negotiate(['fr', 'en'])).toBe('en');
  });

  it('negotiate() falls back to the site default when nothing matches at all', () => {
    expect(negotiate(['fr', 'de'])).toBe(DEFAULT_LOCALE);
    expect(negotiate([])).toBe(DEFAULT_LOCALE);
  });

  it('every activated locale is also catalogued (ACTIVATED_LANGUAGES is a subset of SUPPORTED_LANGUAGES)', () => {
    for (const code of ACTIVATED_LANGUAGES) {
      expect(Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, code)).toBe(true);
    }
  });

  it('the default locale is always activated — the fallback must actually work', () => {
    expect(isActivated(DEFAULT_LOCALE)).toBe(true);
  });

  it("es.json is still structure-only today — this test itself expires the day es is promoted", () => {
    // If this starts failing, es has been translated: update ACTIVATED_LANGUAGES
    // (config.ts) and ES_REQUIRE_COMPLETE (scripts/i18n/check-parity.mjs)
    // together, then delete this test's assumption along with it.
    const esTranslatedCount = Object.values(loadMessages('es')).length;
    expect(esTranslatedCount).toBe(0);
  });
});
