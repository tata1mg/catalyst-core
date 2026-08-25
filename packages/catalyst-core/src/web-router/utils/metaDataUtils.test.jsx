import React from "react"
import { describe, expect, it, vi, afterEach } from "vitest"
import { mergeHeadElements, deleteHeadTagsByDataAttribute, getMetaData } from "./metaDataUtils.jsx"

describe("mergeHeadElements", () => {
    it("returns an empty array when given no lists", () => {
        expect(mergeHeadElements()).toEqual([])
    })

    it("keeps only the last title element when multiple titles are given", () => {
        const first = <title key="a">First</title>
        const second = <title key="b">Second</title>
        const result = mergeHeadElements([first], [second])
        expect(result).toHaveLength(1)
        expect(result[0].props.children).toBe("Second")
    })

    it("dedupes meta tags by name, keeping the later one", () => {
        const first = <meta name="description" content="first" />
        const second = <meta name="description" content="second" />
        const result = mergeHeadElements([first], [second])
        expect(result).toHaveLength(1)
        expect(result[0].props.content).toBe("second")
    })

    it("dedupes meta tags by property when name is absent", () => {
        const first = <meta property="og:title" content="first" />
        const second = <meta property="og:title" content="second" />
        const result = mergeHeadElements([first, second])
        expect(result).toHaveLength(1)
        expect(result[0].props.content).toBe("second")
    })

    it("treats charset meta tags as a single unique slot", () => {
        const first = <meta charSet="utf-8" charset="utf-8" />
        const second = <meta charSet="iso-8859-1" charset="iso-8859-1" />
        const result = mergeHeadElements([first], [second])
        expect(result).toHaveLength(1)
    })

    it("keeps distinct meta tags with different names", () => {
        const description = <meta name="description" content="desc" />
        const keywords = <meta name="keywords" content="kw" />
        const result = mergeHeadElements([description, keywords])
        expect(result).toHaveLength(2)
    })

    it("preserves order across multiple non-overlapping lists", () => {
        const a = <meta name="a" content="1" />
        const b = <meta name="b" content="2" />
        const c = <meta name="c" content="3" />
        const result = mergeHeadElements([a], [b], [c])
        expect(result.map((el) => el.props.name)).toEqual(["a", "b", "c"])
    })

    it("ignores null/undefined lists mixed in with real ones", () => {
        const a = <meta name="a" content="1" />
        const result = mergeHeadElements(null, [a], undefined)
        expect(result).toHaveLength(1)
    })
})

describe("deleteHeadTagsByDataAttribute", () => {
    afterEach(() => {
        document.head.innerHTML = ""
    })

    it("removes every element carrying the given data attribute", () => {
        document.head.innerHTML = `
            <meta data-catalyst="true" name="a">
            <meta data-catalyst="true" name="b">
            <meta name="c">
        `
        deleteHeadTagsByDataAttribute("catalyst")
        expect(document.head.querySelectorAll("[data-catalyst]")).toHaveLength(0)
        expect(document.head.querySelectorAll("meta")).toHaveLength(1)
    })

    it("removes only elements matching a specific attribute value when given one", () => {
        document.head.innerHTML = `
            <meta data-catalyst="route-a" name="a">
            <meta data-catalyst="route-b" name="b">
        `
        deleteHeadTagsByDataAttribute("catalyst", "route-a")
        expect(document.head.querySelector('[data-catalyst="route-a"]')).toBeNull()
        expect(document.head.querySelector('[data-catalyst="route-b"]')).not.toBeNull()
    })

    it("does nothing when no elements match", () => {
        document.head.innerHTML = `<meta name="untouched">`
        expect(() => deleteHeadTagsByDataAttribute("catalyst")).not.toThrow()
        expect(document.head.querySelectorAll("meta")).toHaveLength(1)
    })
})

describe("getMetaData", () => {
    it("returns an empty array when matchedRoutes is undefined", () => {
        expect(getMetaData(undefined, {})).toEqual([])
    })

    it("returns an empty array when no route defines setMetaData", () => {
        const matchedRoutes = [{ route: { component: {} } }]
        expect(getMetaData(matchedRoutes, {})).toEqual([])
    })

    it("calls each route's setMetaData with the route data and merges results", () => {
        const routeData = { title: "Home" }
        const matchedRoutes = [
            {
                route: {
                    component: {
                        setMetaData: (data) => [<title key="t">{data.title}</title>],
                    },
                },
            },
        ]
        const result = getMetaData(matchedRoutes, routeData)
        expect(result).toHaveLength(1)
        expect(result[0].props.children).toBe("Home")
    })

    it("stamps every returned element with data-catalyst and a stable key", () => {
        const matchedRoutes = [
            {
                route: {
                    component: {
                        setMetaData: () => [
                            <meta key="a" name="a" content="1" />,
                            <meta key="b" name="b" content="2" />,
                        ],
                    },
                },
            },
        ]
        const result = getMetaData(matchedRoutes, {})
        expect(result).toHaveLength(2)
        for (const el of result) {
            expect(el.props["data-catalyst"]).toBe(true)
        }
    })

    it("merges tags from multiple matched routes, later routes winning on conflict", () => {
        const matchedRoutes = [
            {
                route: { component: { setMetaData: () => [<meta key="a" name="shared" content="parent" />] } },
            },
            {
                route: { component: { setMetaData: () => [<meta key="b" name="shared" content="child" />] } },
            },
        ]
        const result = getMetaData(matchedRoutes, {})
        expect(result).toHaveLength(1)
        expect(result[0].props.content).toBe("child")
    })

    it("swallows errors from a misbehaving setMetaData and returns an empty array", () => {
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        const matchedRoutes = [
            {
                route: {
                    component: {
                        setMetaData: () => {
                            throw new Error("boom")
                        },
                    },
                },
            },
        ]
        expect(() => getMetaData(matchedRoutes, {})).not.toThrow()
        expect(getMetaData(matchedRoutes, {})).toEqual([])
        consoleSpy.mockRestore()
    })
})
