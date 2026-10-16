import { describe, it, expect } from "vitest"
import { flattenHeadElements, pageInfoTool } from "./pageInfo.js"

// Plain objects with the stable `.type` / `.props` shape of a React element.
const el = (type, props = {}) => ({ type, props })

describe("flattenHeadElements", () => {
    it("flattens title, description, canonical, keywords, og, twitter and other meta", () => {
        const out = flattenHeadElements([
            el("title", { children: "Home" }),
            [
                el("meta", { name: "description", content: "d" }),
                el("meta", { name: "keywords", content: "k" }),
                el("link", { rel: "canonical", href: "https://x.test/" }),
                el("meta", { property: "og:title", content: "OG" }),
                el("meta", { name: "twitter:card", content: "summary" }),
                el("meta", { httpEquiv: "refresh", content: "5" }),
            ],
        ])
        expect(out).toMatchObject({
            title: "Home",
            description: "d",
            keywords: "k",
            canonical: "https://x.test/",
            og: { title: "OG" },
            twitter: { card: "summary" },
            other: { refresh: "5" },
        })
    })

    it("joins array/number title children and drops empty groups", () => {
        const out = flattenHeadElements([el("title", { children: ["Docs", " - ", 2] })])
        expect(out.title).toBe("Docs - 2")
        expect(out).not.toHaveProperty("og")
        expect(out).not.toHaveProperty("twitter")
        expect(out).not.toHaveProperty("other")
    })

    it("ignores non-elements, keyless meta, and a canonical link without href", () => {
        const out = flattenHeadElements([
            null,
            "text",
            el(null),
            el("meta", { content: "orphan" }),
            el("link", { rel: "canonical" }),
        ])
        expect(out.canonical).toBeNull()
        expect(out.title).toBeNull()
    })

    it("returns null title for missing or non-text children", () => {
        expect(flattenHeadElements([el("title")]).title).toBeNull()
        expect(flattenHeadElements([el("title", { children: { x: 1 } })]).title).toBeNull()
    })
})

describe("pageInfoTool", () => {
    const matchWith = (fn) => [{ route: { component: { setMetaData: fn } } }]

    it("collects setMetaData from every matched route, passing route data", async () => {
        let seen
        const tool = pageInfoTool(
            () => matchWith((data) => ((seen = data), [el("title", { children: "T" })])),
            () => ({ a: 1 })
        )
        const res = await tool.execute()
        expect(seen).toEqual({ a: 1 })
        expect(res.title).toBe("T")
        expect(res._note).toBeUndefined()
    })

    it("survives a throwing setMetaData and notes that nothing was reported", async () => {
        const tool = pageInfoTool(() => matchWith(() => { throw new Error("nope") }))
        const res = await tool.execute()
        expect(res.title).toBeNull()
        expect(res._note).toMatch(/no setMetaData/)
    })

    it("tolerates no matches and no route-data getter", async () => {
        const tool = pageInfoTool(() => null)
        const res = await tool.execute()
        expect(res._note).toBeDefined()
        expect(tool.annotations.readOnlyHint).toBe(true)
    })
})
