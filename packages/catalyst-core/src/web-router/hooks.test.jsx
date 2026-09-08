import React from "react"
import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { useNavigateWithTransition } from "./hooks.jsx"

// useNavigateWithTransition currently just returns react-router's
// useNavigate (the transition wrapper is commented out in the source).
// This locks that contract so a future change is a conscious one.

describe("useNavigateWithTransition", () => {
    it("returns a callable navigate function", () => {
        const { result } = renderHook(() => useNavigateWithTransition(), {
            wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
        })
        expect(typeof result.current).toBe("function")
    })
})
