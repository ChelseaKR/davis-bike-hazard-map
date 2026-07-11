/**
 * Web Push handlers, appended to the Workbox-generated service worker via
 * `workbox.importScripts` (see vite.config.ts) — so we keep generateSW's
 * precache/runtime caching untouched instead of migrating to injectManifest.
 *
 * Plain JS on purpose: importScripts loads a classic script, not a module.
 * The payload parser is a pure function so tests can evaluate this file with a
 * stubbed `self` and drive both listeners without a real push service.
 */

/**
 * Parse a push payload (JSON text from server/lib/pushNotify.ts's AlertPayload)
 * into notification fields, with safe fallbacks for a malformed/absent body so
 * a bad payload still shows *something* rather than throwing inside the SW.
 * Pure — unit-tested.
 */
function parsePushPayload(text) {
  var fallback = {
    title: 'New bike hazard reported',
    body: 'A new hazard was reported on a route or area you watch.',
    url: '/',
    tag: 'hazard-alert',
  };
  if (!text) return fallback;
  try {
    var data = JSON.parse(text);
    return {
      title: typeof data.title === 'string' && data.title ? data.title : fallback.title,
      body: typeof data.body === 'string' && data.body ? data.body : fallback.body,
      url: typeof data.url === 'string' && data.url ? data.url : fallback.url,
      tag: typeof data.tag === 'string' && data.tag ? data.tag : fallback.tag,
    };
  } catch {
    return fallback;
  }
}

self.addEventListener('push', function (event) {
  var payload = parsePushPayload(event.data ? event.data.text() : null);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag, // severity tag: same-severity alerts collapse
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (windows) {
        // Focus an open app window if there is one; otherwise open a new one.
        for (var i = 0; i < windows.length; i++) {
          if ('focus' in windows[i]) return windows[i].focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
