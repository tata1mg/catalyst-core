// The one call that useAI parks while it switches models (auto routing). Pure so every way it can end is unit-tested:
// run it when its model is ready, supersede it with a newer call, cancel it, fail it with the model's error, or drop it on unmount.
// Whatever ends it, the promise the caller is awaiting settles: a parked call is never left hanging.

export interface ParkedCall {
    args: any
    /** The candidate id this call is waiting for. */
    id: string
    settle: (result: any) => void
}

const EMPTY = { output: "", error: null }

export function createPendingSlot() {
    let slot: ParkedCall | null = null
    const end = (result: any) => {
        const call = slot
        slot = null
        call?.settle(result)
    }
    return {
        /** Parks a call. A call that was still waiting is superseded: it settles with an empty result. */
        park(call: ParkedCall) {
            end(EMPTY)
            slot = call
        },
        /** The parked call, removed from the slot, once the model it waits for is selected and ready. Otherwise null. */
        takeIfReady(selectedId: string | undefined, ready: boolean): ParkedCall | null {
            if (!slot || slot.id !== selectedId || !ready) return null
            const call = slot
            slot = null
            return call
        },
        /** The model it waits for failed to start: settle it with that error instead of waiting for a readiness that will not come. */
        fail(selectedId: string | undefined, error: unknown) {
            if (slot && slot.id === selectedId && error) end({ output: "", error })
        },
        /** cancel() and unmount: the call settles empty, without running when the model arrives later. */
        cancel() {
            end(EMPTY)
        },
        get waiting() {
            return slot !== null
        },
    }
}
