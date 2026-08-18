import React from "react"
import { PrefetchLink } from "catalyst-core"
import { QuotePage, quoteLoader } from "@routes/quoteRoute.js"
import css from "./Home.scss"

function Home() {
    return (
        <div className={css.app}>
            <header className={css.appHeader}>
                <h1 className={css.heading}>Suspense-based data fetching</h1>
                <p>
                    This example demonstrates a route <code>loader</code>: one isomorphic data-fetching
                    function replacing paired <code>serverFetcher</code>/<code>clientFetcher</code>, read via{" "}
                    <code>useRouteData()</code>, with a critical/deferred split streamed through Suspense.
                </p>
                <p>
                    <PrefetchLink
                        to="/quote"
                        component={QuotePage}
                        loader={quoteLoader}
                        prefetch="intent"
                        className={css.appLink}
                        data-testid="quote-link"
                    >
                        See a quote &rarr;
                    </PrefetchLink>
                </p>
                <p>
                    (Hover the link above before clicking it — <code>prefetch=&quot;intent&quot;</code> warms
                    the route&apos;s chunk and loader data ahead of navigation.)
                </p>
            </header>
        </div>
    )
}

export default Home
