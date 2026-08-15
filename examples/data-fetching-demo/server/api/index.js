import { defineApi } from "catalyst-core/api"

const QUOTES = [
    { id: 1, text: "Simplicity is the soul of efficiency.", author: "Austin Freeman" },
    { id: 2, text: "Make it work, make it right, make it fast.", author: "Kent Beck" },
    { id: 3, text: "Programs must be written for people to read.", author: "Harold Abelson" },
    { id: 4, text: "The best error message is the one that never shows up.", author: "Thomas Fuchs" },
]

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const getQuoteOfTheDay = defineApi({
    method: "GET",
    path: "/api/quote-of-the-day",
    handler: async () => QUOTES[Math.floor(Math.random() * QUOTES.length)],
})

// Artificial delay — makes the loader's deferred field (relatedQuotes) actually
// observable as streamed-in-after-the-shell instead of resolving too fast to
// tell apart from critical data.
export const getRelatedQuotes = defineApi({
    method: "GET",
    path: "/api/quotes/related/:id",
    handler: async ({ params }) => {
        await wait(600)
        return QUOTES.filter((quote) => String(quote.id) !== params.id).slice(0, 3)
    },
})

export default [getQuoteOfTheDay, getRelatedQuotes]
