import Home from "@containers/Home/Home"
import AITest from "@containers/AITest/AITest"
import AIPlayground from "@containers/AIPlayground/AIPlayground"
import TicTacToe from "@containers/TicTacToe/TicTacToe"
import Chess from "@containers/Chess/Chess"

const routes = [
    {
        path: "/tic-tac-toe",
        component: TicTacToe,
    },
    {
        path: "/chess",
        component: Chess,
    },
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
