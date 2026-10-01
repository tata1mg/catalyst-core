import React from 'react'
import DocsLayout from '../layouts/DocsLayout'
import NotFound from '../containers/NotFound'
import Landing from '../containers/Landing/Landing'
import ErrorsIndexPage from '../components/docs/ErrorsIndexPage'
import ErrorPage from '../components/docs/ErrorPage'
import docsRoutes from '../generated/docsRoutes'
import TryApp from '../containers/TryApp/TryApp'
import Showcase from '../containers/Showcase/Showcase'
import ShowcaseIndex from '../containers/Showcase/ShowcaseIndex'
import VideoStreamShowcase from '../containers/Showcase/sections/VideoStreamShowcase'
import FilePickerShowcase from '../containers/Showcase/sections/FilePickerShowcase'
import GoogleSignInShowcase from '../containers/Showcase/sections/GoogleSignInShowcase'
import NotificationShowcase from '../containers/Showcase/sections/NotificationShowcase'
import AppHome from '../containers/AppHome/AppHome'

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
    <title key="title">{`${title} | Catalyst`}</title>,
    <meta key="robots" name="robots" content="noindex, follow" />,
    <meta
        key="description"
        name="description"
        content="Live demos of Catalyst's native capabilities in the Companion app."
    />,
]

Showcase.setMetaData = showcaseMeta('Showcase')
ShowcaseIndex.setMetaData = showcaseMeta('Showcase')
VideoStreamShowcase.setMetaData = showcaseMeta('Video Stream Showcase')
FilePickerShowcase.setMetaData = showcaseMeta('File Picker Showcase')
GoogleSignInShowcase.setMetaData = showcaseMeta('Google Sign-In Showcase')
NotificationShowcase.setMetaData = showcaseMeta('Notification Showcase')

const routes = [
    {
        path: '/',
        component: DocsLayout,
        children: [
            {
                index: true,
                component: Landing,
            },
            {
                // Companion home (native start URL). In the shell its
                // .app-screen root hides the docs navbar.
                path: 'app',
                end: true,
                component: AppHome,
            },
            {
                path: 'try',
                component: TryApp,
            },
            {
                // Each capability is its own sub-route so switching sections
                // goes through useNativeTransition (native snapshot slide).
                path: 'showcase',
                component: Showcase,
                children: [
                    { index: true, component: ShowcaseIndex },
                    { path: 'video', component: VideoStreamShowcase },
                    { path: 'files', component: FilePickerShowcase },
                    { path: 'signin', component: GoogleSignInShowcase },
                    { path: 'notifications', component: NotificationShowcase },
                ],
            },
            // Generated from content/ — one route per page, paths reproducing
            // the Docusaurus permalinks these URLs are indexed under.
            ...docsRoutes,
            // Framework error reference. The catalog is fetched live from
            // errors/index.json on GitHub (see data/errorsCatalog.js), so
            // these two routes carry no generated content. getDocUrl() in
            // catalyst-core points developers at /errors/<category>/<code>
            // (via the /public_docs/ → root redirect in server/server.js).
            {
                path: '/errors',
                end: true,
                component: ErrorsIndexPage,
            },
            {
                path: '/errors/:category/:code',
                end: true,
                component: ErrorPage,
            },
        ],
    },
    {
        // Must stay top-level: the framework returns HTTP 404 only when the
        // outermost matched route's path is "*".
        path: '*',
        component: NotFound,
    },
]

export default routes
