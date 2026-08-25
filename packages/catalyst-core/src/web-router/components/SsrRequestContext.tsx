import React, { createContext } from "react"

/**
 * Request-scoped SSR flags. `isBot` is true when the request User-Agent matched
 * a known crawler, which forces `ssr: false` split components to render on the
 * server anyway.
 */
export interface SsrRequestContextValue {
    isBot: boolean
}

export interface SsrRequestProviderProps {
    value?: SsrRequestContextValue | null
    children?: any
}

/**
 * SSR request flags (e.g. crawler UA). Set by the document handler via SsrRequestProvider.
 * Kept separate from Split.jsx so the server handler does not import lazy/Suspense code.
 * `window.__CATALYST_IS_BOT__` is inlined for bots that execute JS so hydration matches the server.
 */
export const SsrRequestContext = createContext<SsrRequestContextValue>({ isBot: false })

export function SsrRequestProvider({ value, children }: SsrRequestProviderProps) {
    return (
        <SsrRequestContext.Provider value={value ?? { isBot: false }}>{children}</SsrRequestContext.Provider>
    )
}
