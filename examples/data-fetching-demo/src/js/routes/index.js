import Home from "@containers/Home/Home"
import { QuotePage, quoteLoader } from "./quoteRoute.js"

const routes = [
    {
        path: "/",
        end: true,
        component: Home,
    },
    {
        path: "/quote",
        component: QuotePage,
        loader: quoteLoader,
    },
]

export default routes
