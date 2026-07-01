/**
 * App-root i18n provider (react-intl / FormatJS).
 *
 * Wraps the tree in an `<IntlProvider>` with a negotiated locale (browser today,
 * `Accept-Language` -ready — G11 server negotiation is Phase 3) and exposes a
 * lang-switcher hook (`useLocale`) for a future language selector. Missing `es`
 * keys fall back to the inline English `defaultMessage` (see i18n/config.ts).
 *
 * A test-only hook (`window.__i18nTest`) is exposed ONLY when the build sets
 * `VITE_I18N_TEST_HOOKS=1` — the Playwright pseudolocale build does, the
 * production deploy build does not — so the shipped bundle never carries it. It
 * lets the G9 overflow spec inject a generated `en-XA` catalog at runtime.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { IntlProvider } from 'react-intl';
import { DEFAULT_LOCALE, loadMessages, negotiate, type LanguageCode } from './config.ts';

type OnIntlError = NonNullable<ComponentProps<typeof IntlProvider>['onError']>;

interface LocaleContextValue {
  locale: LanguageCode;
  setLocale: (locale: LanguageCode) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

/**
 * Lang-switcher hook for a future language selector. G11 server-side negotiation
 * (Accept-Language / Vary) is Phase 3; this is the client-side wire.
 */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

// `es` is structure-only, so a missing key falling back to English is expected,
// not an error — swallow react-intl's MISSING_TRANSLATION noise but surface any
// real formatting fault (malformed ICU, missing placeholder value).
const onIntlError: OnIntlError = (err) => {
  if (err.code === 'MISSING_TRANSLATION') return;
  console.error(err);
};

interface TestHandle {
  setLocale: (locale: LanguageCode) => void;
  setMessages: (messages: Record<string, string> | null) => void;
}

export function IntlProviderShell({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<LanguageCode>(() => negotiate());
  // Test-only pseudolocale override (G9). `null` in every shipping build.
  const [testMessages, setTestMessages] = useState<Record<string, string> | null>(null);

  const messages = useMemo(
    () => testMessages ?? loadMessages(locale),
    [locale, testMessages],
  );

  // Keep <html lang> in sync with the active locale (WCAG 3.1.1 / G4).
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);

  // G9 test hook — gated behind the build-time flag so production never ships it.
  useEffect(() => {
    if (import.meta.env.VITE_I18N_TEST_HOOKS !== '1' || typeof window === 'undefined') return;
    const handle: TestHandle = { setLocale, setMessages: setTestMessages };
    (window as unknown as { __i18nTest?: TestHandle }).__i18nTest = handle;
    return () => {
      delete (window as unknown as { __i18nTest?: TestHandle }).__i18nTest;
    };
  }, []);

  const ctx = useMemo<LocaleContextValue>(() => ({ locale, setLocale }), [locale]);

  return (
    <LocaleContext.Provider value={ctx}>
      <IntlProvider
        locale={locale}
        defaultLocale={DEFAULT_LOCALE}
        messages={messages}
        onError={onIntlError}
      >
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
