import React from "react"
import HubLayout from "../layouts/HubLayout"
import docsRoutes from "../generated/docsRoutes"
import Landing from "@containers/Landing/Landing"
import TryApp from "@containers/TryApp/TryApp"
import Showcase from "@containers/Showcase/Showcase"
import ShowcaseIndex from "@containers/Showcase/ShowcaseIndex"
import VideoStreamShowcase from "@containers/Showcase/sections/VideoStreamShowcase"
import FilePickerShowcase from "@containers/Showcase/sections/FilePickerShowcase"
import GoogleSignInShowcase from "@containers/Showcase/sections/GoogleSignInShowcase"
import NotificationShowcase from "@containers/Showcase/sections/NotificationShowcase"
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

const showcaseMeta = (title) => () => [
    <title key="title">{title} | Catalyst</title>,
    <meta key="robots" name="robots" content="noindex, follow" />,
    <meta
        key="description"
        name="description"
        content="Live demos of Catalyst's native capabilities in the Companion app."
    />,
]

Showcase.setMetaData = showcaseMeta("Showcase")
ShowcaseIndex.setMetaData = showcaseMeta("Showcase")
VideoStreamShowcase.setMetaData = showcaseMeta("Video Stream Showcase")
FilePickerShowcase.setMetaData = showcaseMeta("File Picker Showcase")
GoogleSignInShowcase.setMetaData = showcaseMeta("Google Sign-In Showcase")
NotificationShowcase.setMetaData = showcaseMeta("Notification Showcase")

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
                // Each capability is its own sub-route so switching sections
                // goes through useNativeTransition (native snapshot slide).
                path: "showcase",
                component: Showcase,
                children: [
                    { index: true, component: ShowcaseIndex },
                    { path: "video", component: VideoStreamShowcase },
                    { path: "files", component: FilePickerShowcase },
                    { path: "signin", component: GoogleSignInShowcase },
                    { path: "notifications", component: NotificationShowcase },
                ],
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
