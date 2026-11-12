// Server hooks of the fixture app: every call is recorded in globalThis.__T.calls, and a test can
// answer from a hook through globalThis.__T.hooks[name].
const T = () => globalThis.__T
const call = (name, args) => {
    T().calls.push([name, args.error?.message ?? args.name ?? null])
    return T().hooks?.[name]?.(args)
}
export const onRenderError = (args) => call("onRenderError", args)
export const onFetcherError = (args) => call("onFetcherError", args)
export const onDeferredError = (args) => call("onDeferredError", args)
export const onAppServerSideError = (args) => call("onAppServerSideError", args)
export const onRequestError = (args) => call("onRequestError", args)
export const isBlockingRequest = () => Boolean(T().blocking)
