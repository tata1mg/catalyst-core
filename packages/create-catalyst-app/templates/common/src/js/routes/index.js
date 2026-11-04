import { split } from "catalyst-core"

// split() lets Catalyst run the page's serverFetcher and clientFetcher.
const Home = split(() => import("@containers/Home/Home"))

const routes = [
    {
        path: "/",
        end: true,
        component: Home,
    },
]

export default routes
