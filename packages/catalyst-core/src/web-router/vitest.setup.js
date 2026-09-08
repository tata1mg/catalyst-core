import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// RTL only auto-cleans up between tests when a test framework's globals
// are detected in a way it recognizes (works out of the box with Jest);
// under Vitest it needs to be wired explicitly, or renders from one test
// leak into the next and multi-render tests using the same testids across
// `it` blocks start finding duplicate elements.
afterEach(() => {
    cleanup()
})
