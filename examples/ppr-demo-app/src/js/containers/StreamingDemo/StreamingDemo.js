import React, { Suspense } from "react"
import { usePPRRouteData } from "catalyst-core"
import fetchFunction from "@api"
import css from "./StreamingDemo.scss"

// No renderMode set on this route (see routes/index.js) — the streaming
// default. Uses usePPRRouteData() (not serverFetcher) so the fetch and the
// render happen in parallel: the shell below (header, notice) streams to the
// client immediately via renderToPipeableStream, while LiveQueue suspends
// and streams in separately once the fetch resolves — nothing here blocks
// the initial response the way an eagerly-awaited serverFetcher would.
// Nothing is ever cached: a fresh fetch runs, and the whole promise cache is
// cleared, on every single request (see handler.jsx's _renderMarkUp).
function fetchLiveOrdersFeed() {
    return fetchFunction("/api/live-orders-feed")
}

function statusClass(status) {
    if (status === "Delivered") return css.statusDelivered
    if (status === "Out for delivery") return css.statusOutForDelivery
    return css.statusPreparing
}

function LiveQueue() {
    const data = usePPRRouteData(fetchLiveOrdersFeed)

    return (
        <>
            <div className={css.kpiGrid}>
                <div className={css.kpiCard}>
                    <p className={css.kpiLabel}>Queue length</p>
                    <p className={css.kpiValue}>{data.queueLength}</p>
                </div>
                <div className={css.kpiCard}>
                    <p className={css.kpiLabel}>Avg prep time</p>
                    <p className={css.kpiValue}>{data.avgPrepTimeMins}m</p>
                </div>
                <div className={css.kpiCard}>
                    <p className={css.kpiLabel}>Active riders</p>
                    <p className={css.kpiValue}>{data.activeRiders}</p>
                </div>
                <div className={css.kpiCard}>
                    <p className={css.kpiLabel}>Orders / hour</p>
                    <p className={css.kpiValue}>{data.ordersPerHour}</p>
                </div>
            </div>

            <div className={css.queuePanel}>
                <p className={css.panelTitle}>Kitchen queue</p>
                <table className={css.table}>
                    <thead>
                        <tr>
                            <th>Order</th>
                            <th>Item</th>
                            <th>Customer</th>
                            <th>Rider</th>
                            <th>ETA</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.queue.map((order) => (
                            <tr key={order.id}>
                                <td>{order.id}</td>
                                <td>{order.item}</td>
                                <td>{order.customer}</td>
                                <td>{order.rider}</td>
                                <td>{order.etaMins}m</td>
                                <td>
                                    <span className={statusClass(order.status)}>{order.status}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    )
}

function QueueSkeleton() {
    return <div className={css.skeleton}>Fetching the live queue&hellip;</div>
}

function StreamingDemo() {
    return (
        <div className={css.page}>
            <header className={css.header}>
                <div className={css.headerInner}>
                    <div>
                        <h1 className={css.title}>Live Orders Feed</h1>
                        <p className={css.subtitle}>
                            A kitchen-display-style ops view — the kind of page where every number needs to
                            be right now, not from five minutes ago.
                        </p>
                    </div>
                    <span className={css.freshBadge}>
                        <span className={css.pulseDot} />
                        streaming — no cache
                    </span>
                </div>
            </header>

            <main className={css.main}>
                <div className={css.notice}>
                    This route has no <code>renderMode</code> set — it's the streaming default — and fetches
                    via <code>usePPRRouteData()</code> instead of <code>serverFetcher</code>: this shell
                    streams to you immediately, and the queue below streams in separately, in parallel with
                    its own fetch, rather than the whole page waiting on it. There's no cache and no{" "}
                    <code>x-rendering-mode</code> response header at all (its absence is the signal you're on
                    this path) — refresh and every value below changes.
                </div>

                <Suspense fallback={<QueueSkeleton />}>
                    <LiveQueue />
                </Suspense>

                <p className={css.footerNote}>
                    Open devtools and refresh — this text above arrives instantly, then the queue below
                    streams in about ~900ms later once its fetch resolves. Compare to how <code>/dashboard</code>
                    's shell is instant AND cached across requests, or how a <code>serverFetcher</code>-based
                    streaming route would hold back this entire response until the fetch finishes.
                </p>
            </main>
        </div>
    )
}

export default StreamingDemo
