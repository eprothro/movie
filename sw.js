const CACHE = "movie-night-v6";
const ASSETS = [
  "/",
  "/index.html",
  "/admin/",
  "/admin/index.html",
  "/css/site.css",
  "/css/admin.css",
  "/js/config.js",
  "/js/sunset.js",
  "/js/scene.js",
  "/js/api.js",
  "/js/app.js",
  "/js/admin.js",
  "/fonts/fraunces.woff2",
  "/fonts/fraunces-italic.woff2",
  "/fonts/outfit.woff2",
  "/assets/scene/stars.svg",
  "/assets/scene/treeline.svg",
  "/assets/scene/hills-back.svg",
  "/assets/scene/hills-front.svg",
  "/assets/scene/oak.svg",
  "/assets/scene/fence.svg",
  "/assets/scene/grass.svg",
  "/assets/scene/meadow.svg",
  "/favicon.svg",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/og.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const fallback = url.pathname.startsWith("/admin") ? "/admin/index.html" : "/index.html";
          return caches.match(fallback);
        }
        return new Response("", { status: 504, statusText: "Offline" });
      }),
  );
});
