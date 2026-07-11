import { split } from "catalyst-core"
import Home from "@containers/Home/Home"

// PPR is an explicit per-route opt-in (no global ENABLE_PPR toggle) — set
// directly on the component, same convention as static's renderMode below.

const Dashboard = split(()=>import("@containers/Dashboard/Dashboard"))

const StaticDemo = split(() => import("@containers/StaticDemo/StaticDemo"))
// handler.jsx's render-mode check is synchronous (it can't await .load()), so
// renderMode has to be mirrored onto the split() wrapper itself, not just the
// underlying component the wrapper lazily resolves to.

// serverFetcher is only discovered off a lazy-loaded (split()) component —
// StreamingDemo went back to serverFetcher (see StreamingDemo.js), so this
// needs split() again.
const StreamingDemo = split(() => import("@containers/StreamingDemo/StreamingDemo"))
// No renderMode set — this route is the streaming default.

Home.renderMode = "ppr"
Dashboard.renderMode = "ppr"
StaticDemo.renderMode = "static"

const routes = [
    {
        path: "/",
        end: true,
        component: Home,
    },
    {
        path: "/dashboard",
        end: true,
        component: Dashboard,
    },
    {
        path: "/pricing",
        end: true,
        component: StaticDemo,
    },
    {
        path: "/streaming-demo",
        end: true,
        component: StreamingDemo,
    },
]

export default routes
