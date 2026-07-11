import React, { Suspense } from "react"
import { Link, usePPRRouteData, DynamicDataProvider } from "catalyst-core"
import fetchFunction from "@api"
import css from "./Home.scss"

// A trivial dynamic fetch so this route also has PPR-postponed content.
// Must be wrapped in <DynamicDataProvider> (below) — that's what aborts the
// prerender pass and produces a postponed subtree to resume per request.
// Hits a real endpoint (server/mockApi.js) rather than fabricating data
// in-process, so this shows up as an actual network call.
function fetchGreeting() {
    return fetchFunction("/api/greeting")
}

function LiveGreeting() {
    const data = usePPRRouteData(fetchGreeting)
    return <p>Server says hello at: {data.servedAt}</p>
}

function Home() {
    return (
        <div className={css.app}>
            <header className={css.appHeader}>
                <h1 className={css.heading}>Catalyst</h1>
                <p>Edit files inside src directory and save to reload.</p>
                <DynamicDataProvider>
                    <Suspense fallback={<p>Loading…</p>}>
                        <LiveGreeting />
                    </Suspense>
                </DynamicDataProvider>
                <p>
                    <Link className={css.appLink} to="/dashboard">
                        View the analytics dashboard demo (PPR Rendering Mode)
                    </Link>
                </p>
                <p>
                    <Link className={css.appLink} to="/pricing">
                        View the static full-page cache demo (Static Rendering Mode)
                    </Link>
                </p>
                <p>
                    <Link className={css.appLink} to="/streaming-demo">
                        View the streaming (default) demo (Fetch then Render)
                    </Link>
                </p>
                <a
                    className={css.appLink}
                    href="https://catalyst.1mg.com"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Learn Catalyst
                </a>
            </header>
        </div>
    )
}

export default Home
