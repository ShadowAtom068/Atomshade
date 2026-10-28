// Atomshade service worker: shows notifications when the app is closed or in the background.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = {};
  }
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // If Atomshade is open and in front, the app itself already shows the message.
      const inFront = wins.some((w) => w.visibilityState === 'visible' && w.focused);
      if (inFront && d.type !== 'call') return;
      await self.registration.showNotification(d.title || 'Atomshade', {
        body: d.body || '',
        tag: d.tag || undefined,
        renotify: !!d.tag,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { conv: d.conv || null, type: d.type || 'message' },
        requireInteraction: d.type === 'call',
        vibrate: d.type === 'call' ? [300, 150, 300, 150, 300] : [120],
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conv = event.notification.data && event.notification.data.conv;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) {
          await w.focus();
          w.postMessage({ type: 'open-chat', conv });
          return;
        }
      }
      await self.clients.openWindow(conv ? `/?chat=${encodeURIComponent(conv)}` : '/');
    })()
  );
});
