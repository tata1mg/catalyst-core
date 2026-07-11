import React, { Suspense } from "react"
import { usePPRRouteData, DynamicDataProvider } from "catalyst-core"
import fetchFunction from "@api"

/**
 * Hits a real endpoint (server/mockApi.js's /api/live-order-stats, ~900ms
 * artificial latency) rather than fabricating data in-process — resolves
 * with fresh data every call, never the same value twice.
 */
function fetchLiveOrderStats() {
    return fetchFunction("/api/live-order-stats")
}

function LiveOrderStats() {
    // Suspends on the prerender pass (data isn't ready yet) — React postpones
    // this subtree out of the cached shell. On every subsequent request the
    // postponed subtree is resumed and this promise is re-created and re-awaited,
    // so the data below is always fresh.
    const data = usePPRRouteData(fetchLiveOrderStats)
    return (
        <div style={{ padding: "12px", border: "2px solid #2f8f4e", borderRadius: "8px" }}>
            <p>
                Live order count: <strong>{data.orderCount}</strong>
            </p>
            <p>
                Fetched at: <strong>{data.fetchedAt}</strong>
            </p>
        </div>
    )
}

function StaticShell() {
    // Rendered exactly once — during the single prerender pass that populates
    // the shell cache. Every later request replays the cached prelude bytes
    // as-is. Deliberately no Date()/Math.random() here: any value computed
    // directly in a non-suspense component's render body gets recomputed
    // during client hydration too, and since hydration must produce the same
    // output as the server HTML it's reconciling against, a live timestamp
    // here would trigger a hydration mismatch rather than prove caching.
    return (
        <div style={{ padding: "12px", border: "2px solid #4a6ee0", borderRadius: "8px" }}>
            <p>
                This block is <strong>static</strong> — part of the cached prerendered shell.
            </p>
            <p>It's served identically on every request until the shell cache is cleared.</p>
        </div>
    )
}

function PprDemo() {
    return (
        <div style={{ fontFamily: "sans-serif", maxWidth: "640px", margin: "40px auto", lineHeight: 1.5 }}>
            <h1>Partial Prerendering (PPR) Demo</h1>

            <h2>Static part (cached shell)</h2>
            <StaticShell />

            <h2>Dynamic part (resolved fresh every request)</h2>
            <DynamicDataProvider>
                <Suspense fallback={<p>Loading live stats…</p>}>
                    <LiveOrderStats />
                </Suspense>
            </DynamicDataProvider>
        </div>
    )
}

export default PprDemo
