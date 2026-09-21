/* AstrOlmué — service worker: push (Pusher Beams) + bandeja local + caché para abrir sin red */
importScripts("vendor/beams-sw.js");

const CACHE = "astrolmue-mobile-v2";
const ASSETS = ["./", "index.html", "app.css", "app.js", "config.js", "vendor/beams.js", "logo.svg", "wordmark.svg", "manifest.json"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {}))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).pathname.includes("/api/")) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});

// --- bandeja en IndexedDB (misma que usa app.js) ---
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("astrolmue", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("inbox", { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function store(n) {
  const db = await openDb(); const tx = db.transaction("inbox", "readwrite");
  tx.objectStore("inbox").add(n);
  return new Promise((res) => (tx.oncomplete = res));
}

// Beams entrega aquí cada push: guardamos y luego mostramos la notificación
PusherPushNotifications.onNotificationReceived = ({ pushEvent, payload, handleNotification }) => {
  const d = payload.data || {};
  const n = { title: d.title || payload.notification?.title || "AstrOlmué", body: d.body || payload.notification?.body || "",
              kind: d.kind || "info", ts: d.ts || new Date().toISOString(), read: false };
  pushEvent.waitUntil((async () => {
    try { await store(n); } catch {}
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    cs.forEach((c) => c.postMessage({ type: "notification" }));
    await handleNotification(payload);
  })());
};

// Web Push estándar (iPhone / VAPID): el Mac manda {astrolmue:true, title, body, data}
self.addEventListener("push", (e) => {
  let p = null; try { p = e.data.json(); } catch { return; }
  if (!p || !p.astrolmue) return;   // los de Beams los atiende su propio handler
  const d = p.data || {};
  const n = { title: d.title || p.title, body: d.body || p.body || "", kind: d.kind || "info", ts: d.ts || new Date().toISOString(), read: false };
  e.waitUntil((async () => {
    try { await store(n); } catch {}
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    cs.forEach((c) => c.postMessage({ type: "notification" }));
    await self.registration.showNotification(p.title, { body: p.body, icon: "icon-192.png", badge: "icon-192.png", tag: "astrolmue-" + (d.id || Date.now()), data: d });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => cs.length ? cs[0].focus() : self.clients.openWindow("./")));
});
