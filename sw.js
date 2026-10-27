"use strict";

// Service Worker für Sonnenflug – Cache-First-Strategie.
// Beim ersten Besuch werden alle Dateien im Browser-Cache gespeichert;
// danach startet die App komplett offline (z. B. im Flugmodus).
//
// WICHTIG: Nach Änderungen an den App-Dateien die VERSION hochzählen,
// damit alte Caches beim nächsten Online-Besuch verworfen werden.
const VERSION = "sonnenflug-v1";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./waypoints.js",
  "./coastlines.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Installation: alles cachen, dann sofort aktiv werden
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Aktivierung: veraltete Caches (andere Versionsnummern) löschen
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Anfragen: zuerst Cache, sonst Netzwerk
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then((res) => res || fetch(e.request))
  );
});
