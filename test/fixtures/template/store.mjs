// A minimal redux-like store; the current one is exposed as globalThis.__T.store.
export default async function createStore() {
    let state = { orders: { list: [] }, shell: { title: "shell" } }
    const store = {
        getState: () => state,
        dispatch(action) {
            if (action.type === "orders") state = { ...state, orders: { list: action.list } }
            return action
        },
        subscribe: () => () => {},
    }
    globalThis.__T.store = store
    return store
}
