// Fixture Redux-ish store for the SSR handler tests (#348). handler.jsx
// calls `createStore({}, req, res)` when validateConfigureStore passes,
// then reads store.getState() during render. A minimal object with
// getState/dispatch/subscribe satisfies react-redux's <Provider>.

export default async function createStore(initialState = {}) {
    let state = { ...initialState }
    return {
        getState: () => state,
        dispatch: (action) => action,
        subscribe: () => () => {},
        replaceReducer: () => {},
        // react-redux 8+ Provider checks for this symbol-less shape; the
        // above four methods are enough for SSR render.
        [Symbol.observable ?? "@@observable"]: () => ({
            subscribe: () => ({ unsubscribe: () => {} }),
        }),
    }
}
