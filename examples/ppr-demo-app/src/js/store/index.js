/**
 * Minimal store satisfying react-redux's Provider contract (getState/dispatch/subscribe).
 * This demo has no real app state — PPR data flows through usePPRRouteData(), not redux.
 */
const createStore = async () => {
    let state = {}
    const listeners = new Set()

    return {
        getState: () => state,
        dispatch: (action) => action,
        subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        replaceReducer: () => {},
    }
}

export default createStore
