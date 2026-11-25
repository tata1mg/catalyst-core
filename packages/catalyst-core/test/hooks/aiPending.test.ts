import { describe, expect, it, vi } from "vitest"
import { createGenerationGuard, createPendingSlot } from "../../src/native/bridge/hooks/aiPending"

const call = (id: string) => ({ args: { messages: [] }, id, settle: vi.fn() })

describe("the call parked while a model switches", () => {
    it("is handed over only once its own model is selected and ready", () => {
        const slot = createPendingSlot()
        const c = call("a")
        slot.park(c)
        expect(slot.takeIfReady("b", true)).toBeNull() // another model
        expect(slot.takeIfReady("a", false)).toBeNull() // not ready yet
        expect(slot.takeIfReady("a", true)).toBe(c)
        expect(slot.waiting).toBe(false)
        expect(c.settle).not.toHaveBeenCalled() // the caller runs it and settles it
    })

    it("a newer call supersedes it: the old one settles empty and never runs", () => {
        const slot = createPendingSlot()
        const first = call("a"), second = call("b")
        slot.park(first)
        slot.park(second)
        expect(first.settle).toHaveBeenCalledWith({ output: "", error: null })
        expect(slot.takeIfReady("a", true)).toBeNull()
        expect(slot.takeIfReady("b", true)).toBe(second)
    })

    it("cancel() settles it empty so it cannot run later with its media", () => {
        const slot = createPendingSlot()
        const c = call("a")
        slot.park(c)
        slot.cancel()
        expect(c.settle).toHaveBeenCalledWith({ output: "", error: null })
        expect(slot.takeIfReady("a", true)).toBeNull()
        slot.cancel() // nothing parked: harmless
    })

    it("a model that fails to start ends the call with that error, only for the model it waits for", () => {
        const slot = createPendingSlot()
        const c = call("a")
        slot.park(c)
        const error = new Error("init failed")
        slot.fail("b", error)
        expect(c.settle).not.toHaveBeenCalled()
        slot.fail("a", null) // no error yet
        expect(c.settle).not.toHaveBeenCalled()
        slot.fail("a", error)
        expect(c.settle).toHaveBeenCalledWith({ output: "", error })
        expect(slot.waiting).toBe(false)
    })
})

describe("createGenerationGuard", () => {
    it("ends a call that was routing when cancel() ran, and leaves a later call alone", () => {
        const guard = createGenerationGuard()
        const routing = guard.begin()
        guard.cancel() // cancel() while the first call is still being routed
        expect(guard.stale(routing)).toBe(true)
        expect(guard.stale(guard.begin())).toBe(false)
    })

    it("one cancel ends every call that started before it", () => {
        const guard = createGenerationGuard()
        const a = guard.begin()
        const b = guard.begin()
        guard.cancel()
        expect([a, b].map(guard.stale)).toEqual([true, true])
    })

    it("the newest call wins: an older call that finishes routing later is stale", () => {
        const guard = createGenerationGuard()
        const older = guard.begin()
        const newer = guard.begin()
        expect(guard.stale(newer)).toBe(false)
        expect(guard.stale(older)).toBe(true)
    })
})
