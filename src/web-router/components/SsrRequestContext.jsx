import React, { createContext } from "react"

/**
 * SSR request flags (e.g. crawler UA). Set by the document handler via SsrRequestProvider.
 * Kept separate from Split.jsx so the server handler does not import lazy/Suspense code.
 * `window.__CATALYST_IS_BOT__` is inlined for bots that execute JS so hydration matches the server.
 */
export const SsrRequestContext = createContext({ isBot: false })

export function SsrRequestProvider({ value, children }) {
    return <SsrRequestContext.Provider value={value ?? { isBot: false }}>{children}</SsrRequestContext.Provider>
}
