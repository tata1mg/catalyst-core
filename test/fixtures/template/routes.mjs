// One page, /orders: a header, then an orders section that waits for deferred work. Its behaviour
// is driven by globalThis.__T (set by test/handler.test.mjs).
import React, { Suspense } from "react"
import { useSelector } from "react-redux"
import { Deferred } from "../../../src/web-router/components/Deferred.jsx"

const h = React.createElement
const T = () => globalThis.__T

const Orders = () => {
    const { list } = useSelector((state) => state.orders)
    if (T().throwInOrders && list.length) throw new Error("orders render bug")
    return h("ul", { id: "orders" }, `orders:${list.length}`)
}
const Thrower = () => {
    throw new Error("widget render bug")
}

const Page = () => {
    if (T().throwInShell) throw new Error("shell render bug")
    return h(
        "main",
        null,
        h("header", null, "Header", T().shellPad ? h("p", null, T().shellPad) : null),
        T().throwInBoundary ? h(Suspense, { fallback: h("i", null, "widget") }, h(Thrower)) : null,
        h(Deferred, { name: "orders", fallback: h("p", { id: "skeleton" }, "loading") }, h(Orders))
    )
}
Page.serverFetcher = async (props, args) => T().fetcher(props, args)

export const getRoutes = () => [
    {
        path: "/orders",
        component: {
            load: async () => ({ default: Page }),
            get renderMode() {
                return T().renderMode
            },
        },
    },
]
export const preparedRoutes = () => [{ path: "/orders", element: h(Page) }]
