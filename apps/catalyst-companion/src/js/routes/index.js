import React from "react"
import HubLayout from "../layouts/HubLayout"
import docsRoutes from "../generated/docsRoutes"
import Landing from "@containers/Landing/Landing"
import TryApp from "@containers/TryApp/TryApp"
import Showcase from "@containers/Showcase/Showcase"
import AppHome from "@containers/AppHome/AppHome"
import NotFound from "@containers/NotFound/NotFound"

// Synchronous imports on purpose: split() routes SSR an empty Suspense shell
// on the first (cold) request per process, which crawlers would index. The
// Hub's content set is small; correctness beats code-splitting for phase one.

Landing.setMetaData = () => [
    <title key="title">Catalyst - Universal React Framework for Web, iOS, and Android</title>,
    <meta
        key="description"
        name="description"
        content="Build cross-platform applications with native device capabilities, server-side rendering, and blazing-fast performance from a single React codebase."
    />,
]

// Companion surfaces: reachable by deep link but not part of the public
// site's index (also excluded from the sitemap by the generator).
TryApp.setMetaData = () => [
    <title key="title">Try Your Own App | Catalyst</title>,
    <meta key="robots" name="robots" content="noindex, follow" />,
    <meta
        key="description"
        name="description"
        content="Load any deployed HTTPS app in an isolated native WebView."
    />,
]

Showcase.setMetaData = () => [
    <title key="title">Showcase | Catalyst</title>,
    <meta key="robots" name="robots" content="noindex, follow" />,
    <meta key="description" name="description" content="Catalyst-built experiences." />,
]

const routes = [
    {
        path: "/",
        component: HubLayout,
        children: [
            {
                index: true,
                component: Landing,
            },
            {
                path: "try",
                component: TryApp,
            },
            {
                path: "showcase",
                component: Showcase,
            },
            ...docsRoutes,
        ],
    },
    {
        // Companion home (native start URL). Top-level so it renders its own
        // chrome instead of the docs navbar.
        path: "/app",
        end: true,
        component: AppHome,
    },
    {
        // Must stay top-level: the SSR handler returns HTTP 404 only when the
        // outermost matched route's path is "*".
        path: "*",
        component: NotFound,
    },
]

export default routes
