import Home from "@containers/Home/Home"
import AITest from "@containers/AITest/AITest"
import AIPlayground from "@containers/AIPlayground/AIPlayground"

const routes = [
    {
        path: "/ai-playground",
        component: AIPlayground,
    },
    {
        path: "/ai-test",
        component: AITest,
    },
    {
        path: "/",
        component: Home,
    },
    {
        path: "/:chapter",
        component: Home,
    },
]

export default routes
