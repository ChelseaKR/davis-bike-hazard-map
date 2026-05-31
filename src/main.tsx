import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

// The service worker registration is injected automatically by vite-plugin-pwa
// (injectRegister: 'script-defer') as /registerSW.js, so there is no virtual
// module import here — which keeps the test/dev module graph clean.

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
