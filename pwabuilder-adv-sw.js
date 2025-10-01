// Simple Service Worker - No build tools needed!
const CACHE_VERSION = 'v1';
const STATIC_CACHE = 'static-' + CACHE_VERSION;
const AUDIO_CACHE = 'radio-audio-cache';
const IMAGE_CACHE = 'images-cache';

// Files to cache immediately on install
const STATIC_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  // Static sound effects
  '/sfx/static1.mp3',
  '/sfx/static2.mp3',
  '/sfx/static3.mp3',
  '/sfx/static4.mp3',
  '/sfx/static5.mp3',
  '/sfx/static6.mp3',
  '/sfx/static7.mp3',
  '/sfx/static8.mp3',
  '/sfx/static9.mp3',
  '/sfx/static10.mp3',
  '/sfx/static11.mp3',
  '/sfx/static12.mp3',
  // Logos
  '/logos/Emotion98.3-GTAVC-Logo.webp',
  '/logos/RadioEspantoso-GTAVC-Logo.webp',
  '/logos/Fever_105.webp',
  '/logos/FlashFM.webp',
  '/logos/KChat-GTAVC-Logo.webp',
  '/logos/ViceCityPublicRadio-GTAVC-Logo.svg',
  '/logos/V-Rock-GTAVC-Logo.svg',
  '/logos/Wave103-GTAVC-Logo.svg',
  '/logos/WildstylePirateRadio.webp'
];

// Install event - cache static files
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith('static-') && cacheName !== STATIC_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Radio MP3 files - Cache First (once downloaded, keep forever)
  if (url.pathname.startsWith('/radio/') && url.pathname.endsWith('.mp3')) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(cache => {
        return cache.match(event.request).then(response => {
          if (response) {
            console.log('[SW] Serving radio from cache:', url.pathname);
            return response;
          }
          
          console.log('[SW] Downloading radio file:', url.pathname);
          return fetch(event.request).then(networkResponse => {
            // Clone the response before caching
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return;
  }
  
  // Images - Cache First
  if (event.request.destination === 'image') {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(cache => {
        return cache.match(event.request).then(response => {
          return response || fetch(event.request).then(networkResponse => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return;
  }
  
  // Static files - Cache First, fallback to network
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});

// Listen for messages from the app to preload stations
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PRELOAD_STATION') {
    const { url } = event.data;
    
    console.log('[SW] Preloading station:', url);
    
    // Fetch and cache the station in the background
    caches.open(AUDIO_CACHE).then(cache => {
      fetch(url).then(response => {
        if (response.ok) {
          cache.put(url, response);
          console.log('[SW] Station preloaded:', url);
        }
      }).catch(err => {
        console.log('[SW] Failed to preload:', url, err);
      });
    });
  }
});