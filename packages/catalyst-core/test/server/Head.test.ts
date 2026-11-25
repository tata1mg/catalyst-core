import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Head } from "../../src/server/renderer/document/Head.js"

describe("Head metaTags", () => {
    it("renders only the <title> from metaTags and leaves the <meta> to MetaTag", () => {
        const metaTags = [
            createElement("title", { key: "title" }, "Page title"),
            createElement("meta", { key: "description", name: "description", content: "Page description" }),
        ]

        const html = renderToStaticMarkup(createElement(Head, { metaTags }))

        expect(html).toContain("<title>Page title</title>")
        expect(html).not.toContain('name="description"')
    })
})
