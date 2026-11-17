import React, { useState } from "react"
import { useCurrentRouteData } from "catalyst-core"

// Partial prerendering route: the cached shell holds the skeleton (pprFallback in routes),
// and this page streams in per request with its serverFetcher data.
const PPRPage = () => {
    const { data } = useCurrentRouteData()
    const [clicks, setClicks] = useState(0)

    return (
        <div className="container">
            <h1>Partial prerendering</h1>
            <p data-testid="ppr-data">{data?.message}</p>
            <button type="button" data-testid="ppr-counter" onClick={() => setClicks((n) => n + 1)}>
                clicked {clicks}
            </button>
        </div>
    )
}

PPRPage.serverFetcher = async () => ({ message: "ppr data" })

PPRPage.clientFetcher = async () => ({ message: "ppr data" })

PPRPage.setMetaData = () => [<title key="title">PPR</title>]

export default PPRPage
