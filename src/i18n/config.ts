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

/** Single source of truth for supported languages. Add a locale here + a JSON file to ship it. */
export const SUPPORTED_LANGUAGES = {
  en: 'English',
  es: 'Español',
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

/** Site default / reference locale (G11 negotiation fallback chain terminates here). */
export const DEFAULT_LOCALE: LanguageCode = 'en';

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

/** Type guard: is `tag` one of the shipping locales? */
export function isSupported(tag: string): tag is LanguageCode {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, tag);
}

/**
 * Negotiate a supported locale from an ordered list of BCP-47 language ranges.
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
    if (primary && isSupported(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
