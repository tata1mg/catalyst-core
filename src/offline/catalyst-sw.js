/* eslint-disable no-restricted-globals */
const MANIFEST_URL = "/catalyst-offline-manifest.json"
const OFFLINE_URL = "/offline.html"
const CACHE_PREFIX = "catalyst-offline"
const MANIFEST_CACHE = `${CACHE_PREFIX}-manifest`

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            await loadManifest(true)
            await cacheOfflineFallback()
            await self.skipWaiting()
        })()
    )
})

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            await cleanupOldCaches()
            await self.clients.claim()
        })()
    )
})

self.addEventListener("fetch", (event) => {
    const { request } = event
    if (request.method !== "GET") return

    if (request.mode === "navigate" || request.destination === "document") {
        event.respondWith(handleNavigation(request))
        return
    }

    if (["script", "style", "font", "image"].includes(request.destination)) {
        event.respondWith(handleAsset(request))
    }
})

async function loadManifest(preferNetwork) {
    const cache = await caches.open(MANIFEST_CACHE)

    if (preferNetwork) {
        try {
            const response = await fetch(MANIFEST_URL, { cache: "no-store" })
            if (response.ok) {
                await cache.put(MANIFEST_URL, response.clone())
                const manifest = await response.json()
                cleanupOldCaches(manifest)
                return manifest
            }
        } catch (_) {
            // Fall back to the cached manifest below.
        }
    }

    const cached = await cache.match(MANIFEST_URL)
    if (cached) return cached.json()
    return { buildId: "unknown", routes: [] }
}

async function cacheOfflineFallback() {
    try {
        const cache = await caches.open(`${CACHE_PREFIX}-fallback`)
        const response = await fetch(OFFLINE_URL, { cache: "no-store" })
        if (response.ok) await cache.put(OFFLINE_URL, response)
    } catch (_) {
        // The offline fallback remains unavailable until a later successful install.
    }
}

function routeCacheName(manifest) {
    return `${CACHE_PREFIX}-routes-${manifest.buildId}`
}

function assetCacheName(manifest) {
    return `${CACHE_PREFIX}-assets-${manifest.buildId}`
}

async function cleanupOldCaches(manifest) {
    manifest = manifest || (await loadManifest(false))
    if (!manifest.buildId || manifest.buildId === "unknown") return

    const keep = new Set([
        MANIFEST_CACHE,
        `${CACHE_PREFIX}-fallback`,
        routeCacheName(manifest),
        assetCacheName(manifest),
    ])
    const cacheNames = await caches.keys()
    await Promise.all(
        cacheNames
            .filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name))
            .map((name) => caches.delete(name))
    )
}

function isOfflineRoute(url, manifest) {
    const { pathname } = new URL(url)
    return (manifest.routes || []).some((route) => {
        try {
            return new RegExp(route.regex).test(pathname)
        } catch (_) {
            return false
        }
    })
}

function canStore(response) {
    return !!(response && (response.ok || response.type === "opaque"))
}

async function handleNavigation(request) {
    const manifest = await loadManifest(true)
    if (!isOfflineRoute(request.url, manifest)) return fetch(request)

    const cache = await caches.open(routeCacheName(manifest))
    try {
        const response = await fetch(request)
        const contentType = response.headers.get("content-type") || ""
        if (canStore(response) && contentType.includes("text/html")) {
            await cache.put(request.url, response.clone())
        }
        return response
    } catch (_) {
        const cached = await cache.match(request.url)
        if (cached) return cached

        const offlineResponse = await caches.match(OFFLINE_URL)
        if (offlineResponse) return offlineResponse

        return fetch(OFFLINE_URL)
    }
}

async function handleAsset(request) {
    const manifest = await loadManifest(false)
    const cache = await caches.open(assetCacheName(manifest))
    const cached = await cache.match(request)
    if (cached) return cached

    const response = await fetch(request)
    if (canStore(response)) await cache.put(request, response.clone())
    return response
}
