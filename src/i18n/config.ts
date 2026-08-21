/**
 * i18n runtime configuration (react-intl / FormatJS).
 *
 * Single source of truth for the supported languages, the browser/Accept-Language
 * -ready locale negotiation, and the message loader. English is the reference
 * catalog; Spanish ships **structure-only** (every id present, values empty) so
 * missing keys fall back to the inline English `defaultMessage` at runtime —
 * gettext-style — until they are translated (REVIEW-GATE R3, see docs/I18N.md).
 *
 * INTERNATIONALIZATION-STANDARD §2/§3: react-intl is the canonical stack for new
 * TS/React work (MF2 migration path).
 */
import enCatalog from './locales/en.json';
import esCatalog from './locales/es.json';

/**
 * Every locale with a catalog file — participates in extraction, the G3/G5/G6/
 * G9/G12 gates, and the pseudolocale/translation pipeline, whether or not real
 * visitors can be negotiated into it yet. Add a locale here + a JSON file to
 * start shipping its scaffolding.
 */
export const SUPPORTED_LANGUAGES = {
  en: 'English',
  es: 'Español',
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

/** Site default / reference locale (G11 negotiation fallback chain terminates here). */
export const DEFAULT_LOCALE: LanguageCode = 'en';

/**
 * Locales `negotiate()` will actually select for a visitor — a strict subset
 * of `SUPPORTED_LANGUAGES`. A locale is *catalogued* (has a JSON file, so the
 * gates and tooling stay exercised) before it is *activated* (a real visitor
 * can land in it).
 *
 * `es` is catalogued, not activated: `es.json` is structure-only (0 of 214
 * values translated — REVIEW-GATE R3, docs/I18N.md — "no unreviewed MT" ships
 * in this civic app). Before this list existed, `negotiate()` matched against
 * every catalogued locale, so an `es`-preferring browser got
 * `document.documentElement.lang = 'es'` while every string on the page still
 * rendered in English via the `defaultMessage` fallback — a real mismatch a
 * screen reader or translation tool would trust (issue #112).
 *
 * Move a code here only once its catalog has been through R3's
 * `initial → translated → reviewed → final` pipeline; flip
 * `ES_REQUIRE_COMPLETE` in `scripts/i18n/check-parity.mjs` in the same change
 * so the completeness gate and the negotiation behavior promote together.
 */
export const ACTIVATED_LANGUAGES: readonly LanguageCode[] = ['en'];

/** Is `tag` a locale `negotiate()` may actually select for a visitor? */
export function isActivated(tag: string): tag is LanguageCode {
  return (ACTIVATED_LANGUAGES as readonly string[]).includes(tag);
}

/** The shape `formatjs extract --format simple` writes: a flat `{ id: message }` map. */
type Catalog = Record<string, string>;

const CATALOGS: Record<LanguageCode, Catalog> = {
  en: enCatalog as Catalog,
  es: esCatalog as Catalog,
};

/**
 * Build the `{ id: message }` map for `IntlProvider`, dropping empty
 * (untranslated) values so react-intl falls back to the component's inline
 * English `defaultMessage`. This is the gettext-style fallback that lets `es`
 * ship structure-only without rendering blanks.
 */
export function loadMessages(locale: LanguageCode): Record<string, string> {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  const out: Record<string, string> = {};
  for (const [id, msg] of Object.entries(catalog)) {
    if (typeof msg === 'string' && msg.trim() !== '') out[id] = msg;
  }
  return out;
}

/**
 * Type guard: is `tag` a *catalogued* locale (has a JSON file)? This is
 * broader than "negotiable" — see `isActivated` — and exists for tooling that
 * genuinely wants every declared locale (e.g. a future "Español (coming
 * soon)" listing), not the set a visitor can actually be placed into.
 */
export function isSupported(tag: string): tag is LanguageCode {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, tag);
}

/**
 * Negotiate an *activated* locale from an ordered list of BCP-47 language
 * ranges — never a merely-catalogued one (see `ACTIVATED_LANGUAGES`).
 *
 * Today the source is the browser (`navigator.languages`); a server can pass a
 * parsed `Accept-Language` list here when G11 negotiation lands (Phase 3). Uses
 * RFC 4647 primary-subtag lookup (`es-MX` → `es`) and falls back to the site
 * default (`en`).
 */
export function negotiate(candidates?: readonly string[]): LanguageCode {
  const ranges =
    candidates ??
    (typeof navigator !== 'undefined'
      ? (navigator.languages && navigator.languages.length
          ? navigator.languages
          : [navigator.language]
        ).filter(Boolean)
      : []);

  for (const tag of ranges) {
    if (!tag) continue;
    let primary: string | undefined;
    try {
      primary = new Intl.Locale(tag).language;
    } catch {
      primary = tag.split('-')[0]?.toLowerCase();
    }
    if (primary && isActivated(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
