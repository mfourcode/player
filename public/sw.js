const CACHE = 'frame-shell-v1'

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE)
  const response = await fetch('/')
  await cache.put('/', response.clone())
  const html = await response.text()
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter(url => url.startsWith('/assets/'))
  await cache.addAll(assets)
  await self.skipWaiting()
})()))

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    if (request.mode === 'navigate') {
      try {
        const response = await fetch(request)
        if (response.ok) await cache.put('/', response.clone())
        return response
      } catch {
        return (await cache.match('/')) || Response.error()
      }
    }
    const cached = await cache.match(request)
    if (cached) return cached
    try {
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    } catch (error) {
      throw error
    }
  })())
})
