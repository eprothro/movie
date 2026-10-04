const CACHE = "movie-night-v14";
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
  "/assets/posters/princess-bride.webp",
  "/assets/posters/princess-bride-2x.webp",
  "/assets/posters/top-gun-maverick.webp",
  "/assets/posters/top-gun-maverick-2x.webp",
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
      // Skip the HTTP cache (Pages serves max-age=600), so a new version never
      // installs with the previous deploy's files.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
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

  // Revalidate, so a deploy can't come down as a mix of old and new files.
  event.respondWith(
    fetch(request, { cache: "no-cache" })
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
