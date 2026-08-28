import { describe, expect, it } from "vitest"
import { getAssetManifest, getManifest } from "../../src/server/manifestCache.js"

// manifestCache loads build manifests once at module import, but only when
// NODE_ENV === "production". Tests run with NODE_ENV !== "production", so
// loadManifests() early-returns and both getters yield null. handler.jsx
// tolerates that (`getManifest() || {}`), so this documents the
// non-production contract it relies on. #348 coverage.

describe("manifestCache (non-production)", () => {
    it("getManifest() is null when NODE_ENV is not production", () => {
        expect(process.env.NODE_ENV).not.toBe("production")
        expect(getManifest()).toBeNull()
    })

    it("getAssetManifest() is null when NODE_ENV is not production", () => {
        expect(getAssetManifest()).toBeNull()
    })
})
