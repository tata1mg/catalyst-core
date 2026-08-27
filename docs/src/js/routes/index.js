import DocsLayout from '../layouts/DocsLayout'
import NotFound from '../containers/NotFound'
import Landing from '../containers/Landing/Landing'
import docsRoutes from '../generated/docsRoutes'

const routes = [
    {
        path: '/',
        component: DocsLayout,
        children: [
            {
                index: true,
                component: Landing,
            },
            // Generated from content/ — one route per page, paths reproducing
            // the Docusaurus permalinks these URLs are indexed under.
            ...docsRoutes,
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
