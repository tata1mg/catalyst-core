/**
 * Live loader for the framework error catalog.
 *
 * The list of error codes is the generated `errors/index.json` at the repo
 * root — the same file `catalyst-core`'s `getDocUrl()` points developers at.
 * Rather than bundle a snapshot at docs build time, this fetches it from
 * GitHub whenever a visitor lands on (or navigates to) an `/errors` page, so a
 * code added upstream shows up here without a docs redeploy.
 *
 * The branch it reads from lives in errorsSource.js (currently `epic/329`; see
 * that file for why and when it flips to `main`).
 *
 * Never throws: callers get a `{ ok: true, data }` / `{ ok: false, reason }`
 * result and render the offline panel on the failure branch. The framework
 * would catch a throwing `serverFetcher` anyway (RouterDataProvider puts it on
 * `routeData.error`, which the SSR handler turns into a 404), but a plain
 * sentinel keeps the SSR and CSR branches identical and side-steps relying on
 * an Error's `.message` being presentable.
 */

import { ERRORS_INDEX_RAW_URL, githubBlobUrlFor } from './errorsSource'

export { githubBlobUrlFor }

const TTL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 6000

// Process-local (SSR) / tab-local (CSR) cache. A burst of hits is one request.
let cache = { data: null, at: 0 }

export function rawIndexUrl() {
    return ERRORS_INDEX_RAW_URL
}

/**
 * @returns {Promise<{ok: true, data: Record<string, ErrorEntry>} | {ok: false, reason: string, status?: number}>}
 */
export async function loadErrorsCatalog() {
    if (cache.data && Date.now() - cache.at < TTL_MS) {
        return { ok: true, data: cache.data }
    }

    let res
    try {
        res = await fetch(ERRORS_INDEX_RAW_URL, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { accept: 'application/json' },
        })
    } catch (err) {
        return {
            ok: false,
            reason:
                err?.name === 'TimeoutError'
                    ? 'the request to GitHub timed out'
                    : 'GitHub could not be reached',
        }
    }

    if (!res.ok) {
        return {
            ok: false,
            status: res.status,
            reason: `GitHub returned HTTP ${res.status}`,
        }
    }

    let data
    try {
        data = await res.json()
    } catch {
        return { ok: false, reason: 'the error index could not be parsed' }
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { ok: false, reason: 'the error index was not in the expected shape' }
    }

    cache = { data, at: Date.now() }
    return { ok: true, data }
}

/**
 * Group a flat `{ code: entry }` map into `[{ category, codes: [...] }]`,
 * categories and codes each sorted, ready for the sidebar.
 */
export function groupByCategory(data) {
    const byCategory = new Map()
    for (const [code, entry] of Object.entries(data)) {
        const category = entry.category || 'UNKNOWN'
        if (!byCategory.has(category)) byCategory.set(category, [])
        byCategory.get(category).push(code)
    }
    return [...byCategory.entries()]
        .map(([category, codes]) => ({
            category,
            codes: codes.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
        }))
        .sort((a, b) => a.category.localeCompare(b.category))
}

/**
 * @typedef {Object} ErrorEntry
 * @property {string} category
 * @property {string} message
 * @property {string} details
 * @property {string} suggestedAction
 * @property {string} docUrl
 */
