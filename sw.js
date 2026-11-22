const CACHE_STATIC = "checador-miniser-t0151-static-v1.1.3";
const CACHE_RUNTIME = "checador-minisers-t0151-runtime-v1.1.3";

// Recursos locales esenciales (relativos a la ubicación de sw.js)
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./src/fonts/fonts.css",
  "./src/fonts/Geist-Regular.ttf",
  "./src/fonts/Geist-SemiBold.ttf",
  "./src/icons/checador.svg",
  "./src/icons/checador512.png",
  "./src/icons/checador192.png",
  "./src/icons/checador180.png"  
];

// Dependencias externas declaradas en index.html para tenerlas disponibles offline tras la primera carga
const EXTERNAL_ASSETS = [
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/lucide@1.72.0",
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
];

// Instalación: precachea archivos locales y, en lo posible, librerías externas
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(CACHE_STATIC);
      await staticCache.addAll(STATIC_ASSETS);

      const runtimeCache = await caches.open(CACHE_RUNTIME);
      await Promise.allSettled(
        EXTERNAL_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { mode: "cors" });
            if (response && response.ok) {
              await runtimeCache.put(url, response);
            }
          } catch (err) {
            // Si algún CDN falla al instalar, se cacheará al primer fetch exitoso
          }
        })
      );
    })()
  );
  self.skipWaiting();
});

// Activación: elimina cachés antiguos y toma control de las pestañas abiertas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const validCaches = [CACHE_STATIC, CACHE_RUNTIME];
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !validCaches.includes(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// Interceptación de peticiones
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Solo interceptamos peticiones GET
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Nunca cachear llamadas a la API REST/Auth/Realtime de Supabase ni peticiones no HTTP(S)
  if (!url.protocol.startsWith("http")) return;
  if (url.hostname.includes("supabase.co") && !url.pathname.includes("/storage/v1/object/public/")) {
    return;
  }

  // 1. Navegación HTML (Network First con fallback a caché / index.html offline)
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            const cache = await caches.open(CACHE_STATIC);
            cache.put("./index.html", networkResponse.clone());
            return networkResponse;
          }
          throw new Error("Respuesta de red no válida");
        } catch (err) {
          const cachedPage =
            (await caches.match(request)) ||
            (await caches.match("./index.html")) ||
            (await caches.match("./"));
          return cachedPage || new Response("Sin conexión y sin caché disponible.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
        }
      })()
    );
    return;
  }

  // 2. Recursos estáticos y librerías (Cache First + actualización/guardado en caché)
  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        // Actualización silenciosa en segundo plano si hay conexión
        fetch(request)
          .then((freshResponse) => {
            if (freshResponse && (freshResponse.ok || freshResponse.type === "opaque")) {
              const targetCacheName = url.origin === self.location.origin ? CACHE_STATIC : CACHE_RUNTIME;
              caches.open(targetCacheName).then((cache) => cache.put(request, freshResponse));
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      try {
        const networkResponse = await fetch(request);
        if (networkResponse && (networkResponse.ok || networkResponse.type === "opaque")) {
          const targetCacheName = url.origin === self.location.origin ? CACHE_STATIC : CACHE_RUNTIME;
          const cache = await caches.open(targetCacheName);
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        // Fallback para imágenes o fuentes si no están cacheadas
        if (request.destination === "image") {
          const fallbackIcon = await caches.match("./checador.svg");
          if (fallbackIcon) return fallbackIcon;
        }
        return new Response("", { status: 504, statusText: "Offline" });
      }
    })()
  );
});
