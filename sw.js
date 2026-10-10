/* ===========================================================
   読解練習 — service worker

   取り方は「ネットワーク優先、失敗したらキャッシュ」。
   問題を足したときに古い内容が出続けないようにするため、
   つながっているときは必ず新しいものを取りにいく。
   電波が無いときだけ、前に取っておいたものを出す。
   =========================================================== */

var CACHE = 'dokkai-renshu-v1';

/* 最初に取っておくもの。ここに無いものも、1度開けば自動でたまる */
var SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './data/questions.json',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .catch(function () { /* 1つでも取れなければ諦める。アプリは動く */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;

  /* GET 以外と、別のサイト(Google Fonts など)は何もしない。
     書体が取れないときは、端末の書体に落ちる作りにしてある。 */
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          /* 画面の読み込みなら、とっておいた index.html を出す */
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      })
  );
});
