import React from "react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import SplitInview from "./SplitInview.jsx"

// jsdom does not implement IntersectionObserver -- stub it here and
// capture the callback/options so tests can simulate an intersection
// firing without a real layout engine.
let observedNodes
let ioCallback
let ioOptions

class FakeIntersectionObserver {
    constructor(callback, options) {
        ioCallback = callback
        ioOptions = options
        observedNodes = []
    }
    observe(node) {
        observedNodes.push(node)
    }
    unobserve(node) {
        observedNodes = observedNodes.filter((n) => n !== node)
    }
    disconnect() {
        observedNodes = []
    }
}

function fireIntersection(node, isIntersecting = true) {
    ioCallback([{ target: node, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }])
}

beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("SplitInview", () => {
    it("renders the fallback placeholder before becoming visible", () => {
        render(
            <SplitInview fallback={<span>loading</span>}>
                <span>real content</span>
            </SplitInview>
        )
        expect(screen.getByText("loading")).toBeInTheDocument()
        expect(screen.queryByText("real content")).not.toBeInTheDocument()
    })

    it("renders children once the observer reports an intersection", () => {
        render(
            <SplitInview fallback={<span>loading</span>}>
                <span>real content</span>
            </SplitInview>
        )
        const node = observedNodes[0]
        act(() => {
            fireIntersection(node, true)
        })
        expect(screen.getByText("real content")).toBeInTheDocument()
    })

    it("calls onVisible exactly once when it becomes visible", () => {
        const onVisible = vi.fn()
        render(
            <SplitInview fallback={<span>loading</span>} onVisible={onVisible}>
                <span>real content</span>
            </SplitInview>
        )
        const node = observedNodes[0]
        act(() => {
            fireIntersection(node, true)
            fireIntersection(node, true)
        })
        expect(onVisible).toHaveBeenCalledTimes(1)
    })

    it("ignores non-intersecting entries", () => {
        render(
            <SplitInview fallback={<span>loading</span>}>
                <span>real content</span>
            </SplitInview>
        )
        const node = observedNodes[0]
        act(() => {
            fireIntersection(node, false)
        })
        expect(screen.queryByText("real content")).not.toBeInTheDocument()
    })

    it("renders children immediately when IntersectionObserver is unavailable", () => {
        vi.stubGlobal("IntersectionObserver", undefined)
        render(
            <SplitInview fallback={<span>loading</span>}>
                <span>real content</span>
            </SplitInview>
        )
        expect(screen.getByText("real content")).toBeInTheDocument()
    })

    it("uses a dedicated observer (not the shared default) when rootOptions are given", () => {
        render(
            <SplitInview fallback={<span>loading</span>} rootOptions={{ threshold: 0.5 }}>
                <span>real content</span>
            </SplitInview>
        )
        expect(ioOptions.threshold).toBe(0.5)
    })
})
