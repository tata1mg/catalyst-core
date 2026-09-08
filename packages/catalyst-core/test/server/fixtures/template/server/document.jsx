import React from "react"

// Minimal CustomDocument for the SSR handler fixture (#348). Mirrors the
// shape a scaffolded app's server/document exports: a function taking the
// merged render props and returning the full <html> tree. Renders just
// enough (the app div via props.jsx, a marker for assertions) to let
// renderToPipeableStream produce a stream.
export default function CustomDocument(props) {
    return (
        <html lang={props.lang || "en"}>
            <head>
                <title>fixture</title>
            </head>
            <body>
                <div data-testid="doc-root">{props.jsx}</div>
            </body>
        </html>
    )
}
