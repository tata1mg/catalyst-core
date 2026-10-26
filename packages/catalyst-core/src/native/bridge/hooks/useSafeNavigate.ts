import { useNavigate } from "react-router"

// Stand-in for useNavigate() during server rendering, where nothing can navigate.
const ssrNavigate = (() => {}) as unknown as ReturnType<typeof useNavigate>

/**
 * useNavigate() that is safe to call while server rendering.
 *
 * Server rendering never navigates, so it skips useNavigate there. In dev SSR src/native is compiled to
 * CommonJS while the server's StaticRouter is ESM, which can load a second copy of react-router with no
 * Router context; useNavigate would then throw and take the request, and the dev server, down. `window`
 * is fixed per environment, so the hook order is stable.
 */
export const useSafeNavigate = (): ReturnType<typeof useNavigate> =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    typeof window === "undefined" ? ssrNavigate : useNavigate()
