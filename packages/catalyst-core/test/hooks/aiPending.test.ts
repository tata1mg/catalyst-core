import { describe, expect, it, vi } from "vitest"
import { createPendingSlot } from "../../src/native/bridge/hooks/aiPending"

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
