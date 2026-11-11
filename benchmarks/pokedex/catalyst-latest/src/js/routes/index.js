import { split } from "catalyst-core"
import MainLayout from "../layouts/MainLayout/MainLayout"

const Home = split(() => import("../pages/Home/Home"), { ssr: true })
const Pokemon = split(() => import("../pages/Pokemon/Pokemon"), { ssr: true })

export default [{ path: "/", component: MainLayout, children: [{ index: true, component: Home }, { path: "pokemon/:name", component: Pokemon }] }]
