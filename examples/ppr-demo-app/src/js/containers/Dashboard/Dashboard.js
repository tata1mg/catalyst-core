import React, { Suspense } from "react"
import { usePPRRouteData, DynamicDataProvider } from "catalyst-core"
import fetchFunction from "@api"
import css from "./Dashboard.scss"

const NAV_ITEMS = [
    { icon: "▣", label: "Overview", active: true },
    { icon: "₹", label: "Sales", active: false },
    { icon: "◉", label: "Customers", active: false },
    { icon: "▢", label: "Orders", active: false },
    { icon: "⚙", label: "Settings", active: false },
]

// Matches the fixed Mon–Sun ordering server/mockApi.js's weeklyChart array
// is generated in — the API returns 7 numbers, not labels.
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/**
 * Hits a real endpoint (server/mockApi.js's /api/dashboard-summary, ~3s
 * artificial latency) — the shape a real analytics API would return in one
 * round trip. usePPRRouteData() caches by route (pathname), so every dynamic
 * widget on this page is fed from ONE fetch rather than one call per widget.
 */
function fetchDashboardSummary() {
    return fetchFunction("/api/dashboard-summary")
}

function statusClass(status) {
    if (status === "Delivered") return css.statusDelivered
    if (status === "Pending") return css.statusPending
    return css.statusCancelled
}

// ── Static shell — sidebar + topbar, baked into the cached prerender ──────
function Sidebar() {
    return (
        <aside className={css.sidebar}>
            <div className={css.brand}>
                <span className={css.brandMark}>◆</span>
                Catalyst Analytics
            </div>
            <ul className={css.nav}>
                {NAV_ITEMS.map((item) => (
                    <li key={item.label} className={item.active ? css.navItemActive : css.navItem}>
                        <span className={css.navIcon}>{item.icon}</span>
                        {item.label}
                    </li>
                ))}
            </ul>
            <div className={css.sidebarFooter}>catalyst-core &middot; PPR demo</div>
        </aside>
    )
}

function Topbar() {
    // Rendered once, during the single prerender pass, and replayed as-is on
    // every later request. Deliberately no Date()/Math.random() in this
    // static (non-suspense) component: a value computed directly in render
    // is recomputed during client hydration too, and since hydration must
    // match the server-rendered HTML it's reconciling against, a live
    // timestamp here would trigger a hydration mismatch instead of proving
    // caching. (The dynamic panel below proves per-request freshness; use
    // curl across requests to see this shell's HTML stay byte-identical.)
    return (
        <div className={css.topbar}>
            <div>
                <h1 className={css.title}>Sales Overview</h1>
                <p className={css.subtitle}>Real-time metrics across your store</p>
            </div>
            <span className={css.shellBadge}>static shell (cached)</span>
        </div>
    )
}

function Filters() {
    return (
        <div className={css.filters}>
            <span className={css.filterPill}>Date range: Last 7 days</span>
            <span className={css.filterPill}>Region: All India</span>
            <span className={css.filterPill}>Channel: All</span>
        </div>
    )
}

// ── Dynamic content — resolved fresh on every request ─────────────────────
function DashboardData() {
    const data = usePPRRouteData(fetchDashboardSummary)
    const maxBar = Math.max(...data.weeklyChart)

    return (
        <>
            <div className={css.kpiGrid}>
                <KpiCard label="Revenue (7d)" value={`₹${data.revenue}L`} delta={data.revenueDelta} />
                <KpiCard label="Orders (7d)" value={data.orders.toLocaleString("en-IN")} delta={data.ordersDelta} />
                <KpiCard label="Conversion rate" value={`${data.conversionRate}%`} delta={null} />
                <KpiCard label="Active users" value={data.activeUsers} delta={null} />
            </div>

            <div className={css.row}>
                <div className={css.panel}>
                    <p className={css.panelTitle}>Orders this week</p>
                    <div className={css.chart}>
                        {data.weeklyChart.map((value, i) => (
                            <div key={DAY_LABELS[i]} className={css.chartBarWrap}>
                                <div
                                    className={css.chartBar}
                                    style={{ height: `${(value / maxBar) * 100}%` }}
                                    title={`${value} orders`}
                                />
                                <span className={css.chartLabel}>{DAY_LABELS[i]}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className={css.panel}>
                    <p className={css.panelTitle}>Right now</p>
                    <div className={css.liveBox}>
                        <span>
                            <span className={css.liveDot} />
                            live
                        </span>
                        <p className={css.liveCount}>{data.activeUsers}</p>
                        <p className={css.liveLabel}>shoppers browsing the store</p>
                    </div>
                </div>
            </div>

            <div className={css.panel}>
                <p className={css.panelTitle}>Recent orders</p>
                <table className={css.table}>
                    <thead>
                        <tr>
                            <th>Order</th>
                            <th>Customer</th>
                            <th>Product</th>
                            <th>Amount</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.recentOrders.map((order) => (
                            <tr key={order.id}>
                                <td>{order.id}</td>
                                <td>{order.customer}</td>
                                <td>{order.product}</td>
                                <td>&#8377;{order.amount.toLocaleString("en-IN")}</td>
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

function KpiCard({ label, value, delta }) {
    const deltaNum = delta === null ? null : Number(delta)
    return (
        <div className={css.kpiCard}>
            <p className={css.kpiLabel}>{label}</p>
            <p className={css.kpiValue}>{value}</p>
            {deltaNum !== null && (
                <span className={deltaNum >= 0 ? css.kpiDeltaUp : css.kpiDeltaDown}>
                    {deltaNum >= 0 ? "↑" : "↓"} {Math.abs(deltaNum)}% vs last week
                </span>
            )}
        </div>
    )
}

function DashboardSkeleton() {
    return <div className={css.skeleton}>Loading live metrics&hellip;</div>
}

function Dashboard() {
    return (
        <div className={css.shell}>
            <Sidebar />
            <main className={css.main}>
                <Topbar />
                <Filters />
                <DynamicDataProvider>
                    <Suspense fallback={<DashboardSkeleton />}>
                        <DashboardData />
                    </Suspense>
                </DynamicDataProvider>
            </main>
        </div>
    )
}

export default Dashboard
