const CACHE_NAME = "kensa-study-offline-v2";
const APP_FILES = [
  "./index.html",
  "./exam-list.html",
  "./exam-mode.html",
  "./question.html",
  "./result.html",
  "./subject.html",
  "./progress.html",
  "./flag-list.html",
  "./manifest.webmanifest",
  "./icons/app-192.png",
  "./icons/app-512.png",
  "./icons/splash-mark.png",
  "../CSS/style.css",
  "../JS/app.js",
  "../data/index.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const appUrls = APP_FILES.map((path) => new URL(path, self.registration.scope).href);
    await cache.addAll(appUrls);

    const indexResponse = await cache.match(new URL("../data/index.json", self.registration.scope));
    const index = await indexResponse.json();
    const dataUrls = index.files.map((name) => new URL(`../data/${name}`, self.registration.scope).href);
    await Promise.all(dataUrls.map((url) => cache.add(url)));

    const imagePaths = new Set();
    for (const url of dataUrls) {
      const response = await cache.match(url);
      const questions = await response.json();
      for (const question of questions) {
        for (const image of question.image || []) imagePaths.add(`../images/${image}`);
      }
    }

    // 古い回の一部に画像ファイルが含まれていない場合も、アプリ本体の保存は完了させる。
    await Promise.all([...imagePaths].map(async (path) => {
      try {
        await cache.add(new URL(path, self.registration.scope).href);
      } catch {
        // 見つからない画像はキャッシュ対象から除外する。
      }
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter((name) => name.startsWith("kensa-study-offline-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate" || url.pathname.endsWith(".json") || request.destination === "script" || request.destination === "style") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match(new URL("./index.html", self.registration.scope));
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});
