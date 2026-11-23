// ============================================================================
// ArManaus — service worker
// Guarda a "casca" do site para abrir rápido e funcionar como app na tela
// inicial. Os dados (/api) sempre vêm da rede, para nunca mostrar alerta velho.
// ============================================================================
const VERSAO = 'armanaus-v5';
const CASCA = [
  '/', '/css/app.css', '/js/app.js', '/js/api.js', '/js/ui.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
  '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // Apaga caches de versões anteriores
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API: só rede
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;
  // Navegação: rede primeiro, cópia em cache se estiver offline
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  // Arquivos do próprio site: usa o cache e atualiza em segundo plano
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VERSAO).then(async (cache) => {
      const emCache = await cache.match(e.request);
      const daRede = fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => emCache);
      return emCache || daRede;
    }));
  }
});

// Notificação push enviada pelo servidor (funciona com o site fechado)
self.addEventListener('push', (e) => {
  let dados = {};
  try { dados = e.data ? e.data.json() : {}; } catch { dados = { titulo: 'ArManaus', corpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(dados.titulo || 'ArManaus', {
    body: dados.corpo || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: dados.url || '/mapa' },
  }));
});

// Clique numa notificação abre a página do local
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = e.notification.data?.url || '/mapa';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((janelas) => {
    const aberta = janelas.find((j) => j.url.includes(location.origin));
    if (aberta) { aberta.navigate(destino); return aberta.focus(); }
    return self.clients.openWindow(destino);
  }));
});
