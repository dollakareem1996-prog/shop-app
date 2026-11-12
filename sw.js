/* يحفظ ملفات التطبيق ليفتح بلا إنترنت. بيانات المحل لا تمر من هنا. */
const VERSION = 'shop-v5';
const SHELL = ['./', './index.html', './app.js', './core.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* ---------- إرسال الحركات عند عودة الإنترنت حتى لو كان التطبيق مغلقًا ---------- */
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('shop-ledger', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function kvGet(db, k) { return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
function kvSet(db, k, v) { return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function flushOps(force) {
  const open = await self.clients.matchAll({ type: 'window' });
  if (!force && open.some(c => c.visibilityState === 'visible')) return; // التطبيق المفتوح يتولى الإرسال بنفسه
  const db = await idb();
  const meta = await kvGet(db, 'meta');
  if (!meta || !meta.token || !meta.url) return;
  for (;;) {
    const pending = (await kvGet(db, 'pending')) || [];
    if (!pending.length) return;
    const batch = pending.slice(0, 50);
    const res = await fetch(meta.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'sync', token: meta.token, ops: batch, since: Number.MAX_SAFE_INTEGER }), redirect: 'follow' });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error);
    const rejected = (out.data.results || []).filter(x => x.status === 'rejected').map(x => ({ op: batch.find(o => o.id === x.opId), error: x.error }));
    if (rejected.length) { meta.rejected = (meta.rejected || []).concat(rejected); await kvSet(db, 'meta', meta); }
    const sent = new Set(batch.map(o => o.id));
    await kvSet(db, 'pending', pending.filter(o => !sent.has(o.id)));
  }
}
self.addEventListener('sync', e => { if (e.tag === 'flush-ops') e.waitUntil(flushOps()); });
self.addEventListener('message', e => { if (e.data === 'flush-ops') e.waitUntil(flushOps(true).then(() => e.source && e.source.postMessage('flushed')).catch(err => e.source && e.source.postMessage('flush-error: ' + err.message))); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    // الشبكة أولًا ليصل التحديث، والنسخة المحفوظة عند الانقطاع
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res;
    })));
  }
});
