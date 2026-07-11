import React from "react"
import { useCurrentRouteData } from "catalyst-core"
import fetchFunction from "@api"
import css from "./StaticDemo.scss"

const PLANS = [
    { name: "Starter", price: "₹0", features: ["1 project", "Community support", "Basic analytics"] },
    {
        name: "Pro",
        price: "₹1,499",
        features: ["Unlimited projects", "Priority support", "Advanced analytics", "PPR + static caching"],
        featured: true,
    },
    { name: "Enterprise", price: "Custom", features: ["Dedicated infra", "SLA & onboarding", "SSO/SAML"] },
]

function StaticDemo() {
    const { data } = useCurrentRouteData()

    return (
        <div className={css.page}>
            <span className={css.badge}>rendered once, cached forever</span>
            <h1 className={css.title}>Pricing</h1>
            <p className={css.subtitle}>
                A marketing/pricing page is a great fit for full static caching — it&rsquo;s the same content
                for every visitor, so there&rsquo;s nothing to resolve per request at all.
            </p>

            <div className={css.proof}>
                <div className={css.proofRow}>
                    <span className={css.proofLabel}>Page generated at</span>
                    <span className={css.proofValue}>{data?.generatedAt}</span>
                </div>
                <div className={css.proofRow}>
                    <span className={css.proofLabel}>Build id</span>
                    <span className={css.proofValue}>{data?.buildId}</span>
                </div>
            </div>

            <div className={css.plans}>
                {PLANS.map((plan) => (
                    <div key={plan.name} className={plan.featured ? css.planFeatured : css.plan}>
                        <p className={css.planName}>{plan.name}</p>
                        <p className={css.planPrice}>{plan.price}</p>
                        <p className={css.planPeriod}>per month</p>
                        <ul className={css.planFeatures}>
                            {plan.features.map((f) => (
                                <li key={f}>&#10003; {f}</li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>

            <p className={css.note}>
                Refresh this page — &ldquo;Page generated at&rdquo; and &ldquo;Build id&rdquo; above will NOT
                change. This entire response (not just a shell) was rendered once on the first request after
                the server started, cached in full, and every request since — this one included — is served
                straight from that cache. Check the <code>x-rendering-mode</code> response header:{" "}
                <code>static-cache-miss</code> on the first request, <code>static-cache-hit</code> on every
                one after.
            </p>
        </div>
    )
}

// serverFetcher runs exactly once for this route: the request that populates
// the static-page cache. Every later request replays the cached HTML this
// produced, byte-for-byte — serverFetcher is never invoked again until the
// server restarts (or the cache is cleared). Hits a real endpoint
// (server/mockApi.js's /api/pricing-info) rather than fabricating data
// in-process.
StaticDemo.serverFetcher = async () => {
    return fetchFunction("/api/pricing-info")
}

// Opts this route into full-page static caching (see handler.jsx) instead of
// the classic per-request render or PPR's shell-cache/dynamic-resume split.
StaticDemo.renderMode = "static"

export default StaticDemo
