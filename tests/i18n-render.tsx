/**
 * Test render helper: wraps component renders in an `<IntlProvider>` so
 * react-intl (`useIntl` / `<FormattedMessage>`) has context in jsdom unit tests.
 *
 * Re-exports everything from @testing-library/react and shadows `render` with an
 * IntlProvider-wrapped version, so tests only need to switch their import source
 * (`'@testing-library/react'` → `'../i18n-render.tsx'`) — every `render(...)`
 * call keeps working and keeps rendering the exact English `defaultMessage`s.
 */
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { DEFAULT_LOCALE, loadMessages } from '../src/i18n/config.ts';

type OnIntlError = NonNullable<ComponentProps<typeof IntlProvider>['onError']>;

// Falling back to the inline English defaultMessage is expected in tests
// (the compiled `en` catalog may be a subset); only real faults should throw.
const onError: OnIntlError = (err) => {
  if (err.code === 'MISSING_TRANSLATION') return;
  throw err;
};

function IntlWrapper({ children }: { children: ReactNode }) {
  return (
    <IntlProvider
      locale={DEFAULT_LOCALE}
      defaultLocale={DEFAULT_LOCALE}
      messages={loadMessages(DEFAULT_LOCALE)}
      onError={onError}
    >
      {children}
    </IntlProvider>
  );
}

export * from '@testing-library/react';

export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: IntlWrapper, ...options });
}
