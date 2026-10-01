import React, { useContext } from "react"
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SsrRequestContext, SsrRequestProvider } from "./SsrRequestContext.jsx"

function ContextReader() {
    const value = useContext(SsrRequestContext)
    return <div data-testid="value">{JSON.stringify(value)}</div>
}

describe("SsrRequestContext", () => {
    it("defaults to { isBot: false }", () => {
        expect(SsrRequestContext._currentValue).toEqual({ isBot: false })
    })
})

describe("SsrRequestProvider", () => {
    it("provides the given value to descendants", () => {
        render(
            <SsrRequestProvider value={{ isBot: true }}>
                <ContextReader />
            </SsrRequestProvider>
        )
        expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify({ isBot: true }))
    })

    it("falls back to { isBot: false } when value is null", () => {
        render(
            <SsrRequestProvider value={null}>
                <ContextReader />
            </SsrRequestProvider>
        )
        expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify({ isBot: false }))
    })

    it("falls back to { isBot: false } when value is undefined (not passed)", () => {
        render(
            <SsrRequestProvider>
                <ContextReader />
            </SsrRequestProvider>
        )
        expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify({ isBot: false }))
    })

    it("renders its children", () => {
        render(
            <SsrRequestProvider value={{ isBot: false }}>
                <span>child content</span>
            </SsrRequestProvider>
        )
        expect(screen.getByText("child content")).toBeInTheDocument()
    })
})
