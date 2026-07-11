import React from "react"
import { useCurrentRouteData } from "catalyst-core"
import fetchFunction from "@api"
import css from "./StreamingDemo.scss"

function statusClass(status) {
    if (status === "Delivered") return css.statusDelivered
    if (status === "Out for delivery") return css.statusOutForDelivery
    return css.statusPreparing
}

function StreamingDemo() {
    const { data } = useCurrentRouteData()

    if (!data) {
        return <div className={css.skeleton}>Loading&hellip;</div>
    }

    return (
        <div className={css.page}>
            <header className={css.header}>
                <div className={css.headerInner}>
                    <div>
                        <h1 className={css.title}>{data.kitchenName}</h1>
                        <p className={css.subtitle}>
                            Open since {data.openSince} &middot; {data.staffOnShift} staff on shift. A
                            kitchen-display-style ops view — the kind of page where every number needs to be
                            right now, not from five minutes ago.
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
                    This route has no <code>renderMode</code> set — it's the streaming default.{" "}
                    <code>serverFetcher</code> fetches the header (kitchen name/status) <em>and</em> the queue
                    below in a single round trip, and the whole page waits on both before anything renders.
                    Unlike <code>/dashboard</code>'s cached PPR shell, nothing on this page is ever cached —
                    the header above is fetched fresh on every single request, same as the queue. There's no{" "}
                    <code>x-rendering-mode</code> response header at all (its absence is the signal you're on
                    this path).
                </div>

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

                <p className={css.footerNote}>
                    Refresh — the kitchen name/status above changes just as often as the queue below, because
                    neither is ever cached.
                </p>
            </main>
        </div>
    )
}

// Fetches BOTH the "shell-looking" header data and the queue data in one
// round trip — nothing on this route is ever cached, so this runs again on
// every single request.
async function fetchPageData() {
    const [kitchenStatus, ordersFeed] = await Promise.all([
        fetchFunction("/api/kitchen-status"),
        fetchFunction("/api/live-orders-feed"),
    ])
    return { ...kitchenStatus, ...ordersFeed }
}

// serverFetcher runs on the initial SSR request; clientFetcher runs on
// client-side navigations to this route (and on refetch()) — same fetch
// either way, so they share one implementation.
StreamingDemo.serverFetcher = fetchPageData
StreamingDemo.clientFetcher = fetchPageData

export default StreamingDemo
