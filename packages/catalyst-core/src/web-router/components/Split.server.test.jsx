// @vitest-environment node
//
// Server-side Split coverage (#347/#348-style split). The jsdom
// Split.test.jsx cannot reach these branches -- Split checks
// `typeof window === "undefined"` and jsdom always defines window. Routed
// to the "node" project by the *.server.test.* include/exclude split in
// vitest.config.ts.

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Split from "./Split.jsx"

afterEach(() => {
    delete global.__CHUNK_EXTRACTOR__
    vi.restoreAllMocks()
})

describe("Split (server)", () => {
    it("with ssr enabled: registers the component with the chunk extractor and renders children in Suspense", () => {
        const addComponent = vi.fn()
        global.__CHUNK_EXTRACTOR__ = { addComponent }

        const html = renderToStaticMarkup(
            <Split ssr cacheKey="pages/Widget" fallback={<span>fallback</span>}>
                <p>real child</p>
            </Split>,
        )

        expect(addComponent).toHaveBeenCalledWith("pages/Widget")
        expect(html).toContain("real child")
    })

    it("with ssr enabled and no chunk extractor present: still renders children (no throw)", () => {
        const html = renderToStaticMarkup(
            <Split ssr cacheKey="pages/NoExtractor">
                <p>child ok</p>
            </Split>,
        )
        expect(html).toContain("child ok")
    })

    it("with ssr disabled: renders the fallback wrapped in a <div> to match the client hydration shape", () => {
        const html = renderToStaticMarkup(
            <Split ssr={false} cacheKey="pages/Deferred" fallback={<span>loading…</span>}>
                <p>should not appear</p>
            </Split>,
        )
        expect(html).toBe("<div><span>loading…</span></div>")
        expect(html).not.toContain("should not appear")
    })
})
