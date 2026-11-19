/* BOLT — Service Worker: funciona offline para o app (estáticos). Chamadas /api/* nunca passam pelo cache. */
const VERSION = 'bolt-v1.1.0-standby';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './cockpit.css',
  './standby.css',
  './standby.js',
  './cockpit-gauge.js',
  './cockpit-stage.js',
  './vehicle-catalog.js',
  './manifest.json',
  './ai-service.js',
  './alerts.js',
  './app.js',
  './assistant-local.js',
  './assistant.js',
  './config.js',
  './connectivity.js',
  './data-source.js',
  './database.js',
  './diagnostics.js',
  './dtc-database.js',
  './events.js',
  './garage.js',
  './gauge.js',
  './geo.js',
  './icons.js',
  './maintenance.js',
  './mascot.js',
  './obd-ble.js',
  './obd-dialog.js',
  './obd-manager.js',
  './obd-native.js',
  './obd-protocol.js',
  './obd-transport.js',
  './obd-wifi.js',
  './platform.js',
  './settings.js',
  './silhouettes.js',
  './trips.js',
  './ui.js',
  './utils.js',
  './vehicle-engine.js',
  './vehicle-simulator.js',
  './view-assistant.js',
  './view-dashboard.js',
  './view-diagnostics.js',
  './view-garage.js',
  './view-lab.js',
  './view-maintenance.js',
  './view-settings.js',
  './view-trips.js',
  './voice.js',
  './bolt-icon-maskable.svg',
  './bolt-icon.svg',
  './bolt-logo.svg',
  './bolt-mascot.svg',
  './bolt-splash.svg',
  './favicon.svg',
  './icon-alert.svg',
  './icon-assistant.svg',
  './icon-bluetooth.svg',
  './icon-diagnostics.svg',
  './icon-garage.svg',
  './icon-lab.svg',
  './icon-maintenance.svg',
  './icon-obd.svg',
  './icon-panel.svg',
  './icon-settings.svg',
  './icon-trips.svg',
  './icon-wifi.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  // Estáticos: responde do cache e atualiza em segundo plano (stale-while-revalidate).
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }),
  );
});
