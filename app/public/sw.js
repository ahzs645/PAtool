/**
 * PAtool service worker — offline cache for the static-deploy story.
 *
 * The committed fixture JSON in /data/ is what makes the GitHub Pages
 * deployment self-contained, so it is also exactly the right payload to
 * pre-cache for offline. Hashed Vite build assets are caught with a
 * stale-while-revalidate strategy; everything else falls back to the
 * network and treats the SW as a no-op.
 *
 * Bump CACHE_VERSION when changing the cache strategy or the hard-coded
 * pre-cache list.
 */
/* eslint-disable no-restricted-globals */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `patool-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `patool-assets-${CACHE_VERSION}`;
const DATA_CACHE = `patool-data-${CACHE_VERSION}`;

const SHELL_URLS = [
  "./",
  "./index.html",
  "./favicon.svg",
];

const DATA_URLS = [
  "./data/example_pas.collection.json",
  "./data/example_pat.series.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined)),
      caches.open(DATA_CACHE).then((cache) => cache.addAll(DATA_URLS).catch(() => undefined)),
    ]).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![SHELL_CACHE, ASSET_CACHE, DATA_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return url.pathname.includes("/api/");
}

function isDataRequest(url) {
  return url.pathname.includes("/data/") && url.pathname.endsWith(".json");
}

function isHashedAsset(url) {
  return url.pathname.includes("/assets/") || /\.(?:js|css|woff2?|ttf|svg|png|jpg|webp)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return; // never intercept the live API

  if (isDataRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }
  if (isHashedAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }
  event.respondWith(networkFirst(request, SHELL_CACHE));
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached ?? (await networkPromise) ?? new Response("", { status: 504 });
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const indexFallback = await cache.match("./index.html");
    if (indexFallback) return indexFallback;
    throw error;
  }
}
