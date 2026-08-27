import DocsLayout from '../layouts/DocsLayout'
import NotFound from '../containers/NotFound'
import Landing from '../containers/Landing/Landing'
import ErrorsIndexPage from '../components/docs/ErrorsIndexPage'
import ErrorPage from '../components/docs/ErrorPage'
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
