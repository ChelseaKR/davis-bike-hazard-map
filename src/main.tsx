import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { installGlobalErrorHandlers } from './lib/telemetry.ts';
import './styles.css';

// Report uncaught errors and unhandled rejections, not just React render errors.
installGlobalErrorHandlers();

// The service worker registration is injected automatically by vite-plugin-pwa
// (injectRegister: 'script-defer') as /registerSW.js, so there is no virtual
// module import here — which keeps the test/dev module graph clean.

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary source="app-root">
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
