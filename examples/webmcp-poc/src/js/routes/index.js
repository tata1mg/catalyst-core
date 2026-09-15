import Home from "@pages/Home"
import ProductList from "@pages/ProductList"
import ProductDetail from "@pages/ProductDetail"
import Cart from "@pages/Cart"

const routes = [
    {
        path: "/",
        end: true,
        component: Home,
    },
    {
        path: "/products",
        component: ProductList,
    },
    {
        path: "/product/:id",
        component: ProductDetail,
    },
    {
        path: "/cart",
        component: Cart,
    },
]

export default routes
