// Optional (Approach D): an environment-aware fetch used IDENTICALLY in serverFetcher and
// clientFetcher, so the two read the same at the call site:
//
//   import { apiFetch } from "catalyst-cloudflare/worker/data-fetch"
//   const load = () => apiFetch("/api/x").then((r) => r.json())
//   Page.serverFetcher = load
//   Page.clientFetcher = load
//
// Client: a normal relative fetch (browser attaches cookies). Server: dispatched in-process
// to the app's own route with inbound request context forwarded (runtime.__ctxFetch).
export function apiFetch(path) {
    if (typeof window !== "undefined") {
        return fetch(path)
    }
    return globalThis.__ctxFetch(path)
}
