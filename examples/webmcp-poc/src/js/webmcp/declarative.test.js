import { describe, it, expect, vi } from "vitest"
import {
    toolNameFromPath,
    paramNames,
    fillPath,
    buildInputSchema,
    declarativeToolFor,
    frameworkTools,
} from "./declarative.js"
import { flattenHeadElements } from "./pageInfo.js"
import React from "react"

describe("declarative helpers", () => {
    it("derives tool names from path patterns", () => {
        expect(toolNameFromPath("/")).toBe("home")
        expect(toolNameFromPath("/products")).toBe("products")
        expect(toolNameFromPath("/product/:id")).toBe("product")
        expect(toolNameFromPath("/orders/:oid/items")).toBe("orders_items")
    })

    it("extracts and fills path params", () => {
        expect(paramNames("/product/:id")).toEqual(["id"])
        expect(fillPath("/product/:id", { id: "trail-runner-x" })).toBe("/product/trail-runner-x")
        expect(() => fillPath("/product/:id", {})).toThrow(/missing required path param/)
    })

    it("builds an inputSchema: params required, searchParams optional", () => {
        const s = buildInputSchema("/product/:id", {
            searchParams: { variant: { type: "string" } },
        })
        expect(s.required).toEqual(["id"])
        expect(s.properties.id.type).toBe("string")
        expect(s.properties.variant.type).toBe("string")
        expect(s.required).not.toContain("variant")
    })

    it("declarativeToolFor returns null when the route has no .tool config", () => {
        expect(declarativeToolFor({ path: "/x", component: () => null }, vi.fn())).toBeNull()
    })

    it("declarativeToolFor reads route.tool", async () => {
        const navigate = vi.fn()
        const route = {
            path: "/products",
            component: () => null,
            tool: {
                description: "list",
                searchParams: { category: { type: "string" }, maxPrice: { type: "number" } },
            },
        }
        const spec = declarativeToolFor(route, navigate)
        expect(spec.name).toBe("products")
        expect(spec.annotations.readOnlyHint).toBe(true)

        const res = await spec.execute({ category: "footwear", maxPrice: 3000 })
        expect(navigate).toHaveBeenCalledWith("/products?category=footwear&maxPrice=3000")
        expect(res.navigated).toBe(true)
    })

    it("frameworkTools: navigate enum excludes parameterised routes; rejects unknown", async () => {
        const navigate = vi.fn()
        const routes = [
            { path: "/" },
            { path: "/products" },
            { path: "/product/:id" },
            { path: "/cart" },
        ]
        const [nav] = frameworkTools(routes, navigate, () => ({}))
        expect(nav.inputSchema.properties.path.enum).toEqual(["/", "/products", "/cart"])

        await expect(nav.execute({ path: "/product/:id" })).rejects.toThrow(/not a navigable page/)
        await nav.execute({ path: "/cart" })
        expect(navigate).toHaveBeenCalledWith("/cart")
    })
})

describe("pageInfo.flattenHeadElements", () => {
    it("flattens title / description / og / twitter", () => {
        const els = [
            [
                React.createElement("title", { key: "t" }, "My Page"),
                React.createElement("meta", { key: "d", name: "description", content: "about my page" }),
                React.createElement("meta", { key: "o", property: "og:title", content: "OG My Page" }),
                React.createElement("meta", { key: "w", name: "twitter:card", content: "summary" }),
                React.createElement("meta", { key: "k", name: "keywords", content: "a,b,c" }),
                React.createElement("link", { key: "c", rel: "canonical", href: "https://x.test/" }),
            ],
        ]
        const info = flattenHeadElements(els)
        expect(info.title).toBe("My Page")
        expect(info.description).toBe("about my page")
        expect(info.og.title).toBe("OG My Page")
        expect(info.twitter.card).toBe("summary")
        expect(info.keywords).toBe("a,b,c")
        expect(info.canonical).toBe("https://x.test/")
    })

    it("returns nulls for a page with no head elements", () => {
        const info = flattenHeadElements([])
        expect(info.title).toBeNull()
        expect(info.description).toBeNull()
    })
})
