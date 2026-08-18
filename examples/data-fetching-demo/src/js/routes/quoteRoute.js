import { split } from "catalyst-core"
import { api } from "catalyst-core/api"

// Exported separately from routes/index.js (rather than defined inline there)
// so Home.js can import the same component + loader references for
// PrefetchLink, without Home.js and routes/index.js importing each other.
export const QuotePage = split(() => import("../pages/Quote/Quote"), { ssr: true })

export const quoteLoader = async () => {
    const quote = await api.get("/api/quote-of-the-day") // critical — awaited
    return {
        quote,
        relatedQuotes: api.get(`/api/quotes/related/${quote.id}`), // deferred — not awaited
    }
}
