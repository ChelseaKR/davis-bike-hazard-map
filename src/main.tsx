import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { IntlProviderShell } from './i18n/IntlProviderShell.tsx';
import { installGlobalErrorHandlers } from './lib/telemetry.ts';
import { reportWebVitals } from './lib/vitals.ts';
import './styles.css';

// Report uncaught errors and unhandled rejections, not just React render errors.
installGlobalErrorHandlers();

// Cookieless Core Web Vitals RUM (field LCP/INP/CLS) — best-effort.
reportWebVitals();

// The service worker registration is injected automatically by vite-plugin-pwa
// (injectRegister: 'script-defer') as /registerSW.js, so there is no virtual
// module import here — which keeps the test/dev module graph clean.

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      {/* IntlProvider wraps the root boundary so even the crash-fallback UI is
          localizable and always has intl context. */}
      <IntlProviderShell>
        <ErrorBoundary source="app-root">
          <App />
        </ErrorBoundary>
      </IntlProviderShell>
    </StrictMode>,
  );
}
