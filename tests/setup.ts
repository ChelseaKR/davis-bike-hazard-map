/**
 * Vitest global setup: jest-dom matchers, an IndexedDB polyfill for the
 * offline-queue tests, a working localStorage, and a couple of jsdom gaps the
 * app touches.
 * (Accessibility assertions use the axe-core helper in tests/axe.ts.)
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// Node 26 exposes an experimental global `localStorage` that throws unless a
// --localstorage-file flag is set, shadowing jsdom's. Install a simple,
// dependable in-memory Storage so component code and tests behave like a browser.
function installLocalStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => store.delete(k),
    setItem: (k: string, v: string) => store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
  }
}
installLocalStorage();

// jsdom doesn't implement matchMedia; several components/libraries probe it.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
