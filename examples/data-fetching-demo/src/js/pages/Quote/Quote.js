import React, { Suspense, use } from "react"
import { useRouteData, Link } from "catalyst-core"

// Deferred field: use()'d inside its own Suspense boundary, independent of the
// critical quote above it — this is what makes the streamed-in-after-the-shell
// behavior observable, not just internally correct.
const RelatedQuotes = ({ promise }) => {
    const related = use(promise)
    return (
        <ul data-testid="related-quotes">
            {related.map((quote) => (
                <li key={quote.id}>
                    &ldquo;{quote.text}&rdquo; &mdash; {quote.author}
                </li>
            ))}
        </ul>
    )
}

const Quote = () => {
    const { quote, relatedQuotes } = useRouteData()

    return (
        <div className="container">
            <p>
                <Link to="/">&larr; Back home</Link>
            </p>
            <blockquote data-testid="quote">
                <p>&ldquo;{quote.text}&rdquo;</p>
                <cite>&mdash; {quote.author}</cite>
            </blockquote>
            <h2>You might also like</h2>
            <Suspense fallback={<p data-testid="related-quotes-loading">Loading related quotes...</p>}>
                <RelatedQuotes promise={relatedQuotes} />
            </Suspense>
        </div>
    )
}

export default Quote
