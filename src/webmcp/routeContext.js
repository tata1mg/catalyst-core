import { createContext } from "react"

/**
 * Carries the *route path pattern* of the nearest matched route ("/product/:id",
 * "/cart", …) down to every `useTool` call, so each tool knows which route it
 * belongs to and WebMcpProvider can reap it on navigation.
 *
 * Empty string = "not under a known route" → the tool is treated as
 * app-lifetime, not route-scoped, and is never reaped.
 */
export const RouteContext = createContext("")
