/**
 * Tests for the service worker's Web Push handlers (public/push-sw.js).
 *
 * The file is a plain classic script appended to the Workbox-generated SW via
 * `importScripts` (see vite.config.ts), and jsdom has no ServiceWorkerGlobalScope
 * — so it is evaluated here with a stubbed `self`, and the registered listeners
 * are driven directly. That covers payload parsing (incl. malformed payloads),
 * notification display, and the click-to-focus/open behaviour without a real
 * push service.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

interface FakeWindowClient {
  focus?: () => Promise<unknown>;
}

function loadSw(openWindows: FakeWindowClient[] = []) {
  // Vitest runs from the repo root (same assumption as server/lib/migrate.ts);
  // import.meta.url is an http: URL under jsdom, so resolve from cwd instead.
  const code = readFileSync(join(process.cwd(), 'public', 'push-sw.js'), 'utf8');
  const listeners = new Map<string, (event: unknown) => void>();
  const swSelf = {
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    clients: {
      matchAll: vi.fn().mockResolvedValue(openWindows),
      openWindow: vi.fn().mockResolvedValue(null),
    },
  };
  // Evaluate the classic script with our stub as `self` (shadowing the global).
  new Function('self', `"use strict";\n${code}`)(swSelf);
  return { swSelf, listeners };
}

/** Fire a listener and await whatever it passed to event.waitUntil. */
async function fire(
  listeners: Map<string, (event: unknown) => void>,
  type: string,
  event: Record<string, unknown>,
) {
  const waited: unknown[] = [];
  listeners.get(type)!({ ...event, waitUntil: (p: unknown) => waited.push(p) });
  await Promise.all(waited as Promise<unknown>[]);
}

const payload = {
  title: 'New bike hazard on a saved route',
  body: 'High pothole reported near you.',
  url: '/',
  tag: 'hazard-high',
  hazardId: 'h1',
};

describe('push-sw push handler', () => {
  it('registers both push listeners', () => {
    const { listeners } = loadSw();
    expect([...listeners.keys()].sort()).toEqual(['notificationclick', 'push']);
  });

  it('shows a notification from a JSON payload (severity tag, hazard url)', async () => {
    const { swSelf, listeners } = loadSw();
    await fire(listeners, 'push', { data: { text: () => JSON.stringify(payload) } });
    expect(swSelf.registration.showNotification).toHaveBeenCalledWith(
      payload.title,
      expect.objectContaining({
        body: payload.body,
        tag: 'hazard-high',
        data: { url: '/' },
      }),
    );
  });

  it('falls back to a generic notification on a malformed payload', async () => {
    const { swSelf, listeners } = loadSw();
    await fire(listeners, 'push', { data: { text: () => 'not json {' } });
    const [title, options] = swSelf.registration.showNotification.mock.calls[0];
    expect(title).toMatch(/new bike hazard/i);
    expect(options.tag).toBe('hazard-alert');
    expect(options.data).toEqual({ url: '/' });
  });

  it('falls back when the push event carries no data at all', async () => {
    const { swSelf, listeners } = loadSw();
    await fire(listeners, 'push', { data: null });
    expect(swSelf.registration.showNotification).toHaveBeenCalledTimes(1);
  });
});

describe('push-sw notificationclick handler', () => {
  it('focuses an already-open app window', async () => {
    const win = { focus: vi.fn().mockResolvedValue(undefined) };
    const { swSelf, listeners } = loadSw([win]);
    await fire(listeners, 'notificationclick', {
      notification: { close: vi.fn(), data: { url: '/' } },
    });
    expect(win.focus).toHaveBeenCalled();
    expect(swSelf.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens the hazard URL when no window is open (and closes the notification)', async () => {
    const { swSelf, listeners } = loadSw([]);
    const close = vi.fn();
    await fire(listeners, 'notificationclick', {
      notification: { close, data: { url: '/' } },
    });
    expect(close).toHaveBeenCalled();
    expect(swSelf.clients.openWindow).toHaveBeenCalledWith('/');
  });

  it('defaults to the app root when the notification has no data', async () => {
    const { swSelf, listeners } = loadSw([]);
    await fire(listeners, 'notificationclick', {
      notification: { close: vi.fn(), data: null },
    });
    expect(swSelf.clients.openWindow).toHaveBeenCalledWith('/');
  });
});
