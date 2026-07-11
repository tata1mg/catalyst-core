import express from "express"
import path from "path"
import {
    getGreeting,
    getLiveOrderStats,
    getDashboardSummary,
    getPricingInfo,
    getLiveOrdersFeed,
    getKitchenStatus,
} from "./mockApi.js"

// Server middlewares are added here.

export function addMiddlewares(app) {
    app.use("/favicon.ico", express.static(path.join(process.env.src_path, "public/favicon.ico")))

    // Mock backend for the demo pages — see mockApi.js. Registered before the
    // SSR catch-all in expressServer.js, so these take precedence over it.
    app.get("/api/greeting", getGreeting)
    app.get("/api/live-order-stats", getLiveOrderStats)
    app.get("/api/dashboard-summary", getDashboardSummary)
    app.get("/api/pricing-info", getPricingInfo)
    app.get("/api/live-orders-feed", getLiveOrdersFeed)
    app.get("/api/kitchen-status", getKitchenStatus)
}
