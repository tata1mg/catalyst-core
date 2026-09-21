import Home from "@pages/Home"
import ProductList from "@pages/ProductList"
import ProductDetail from "@pages/ProductDetail"
import Cart from "@pages/Cart"

// route.tool — declarative WebMCP read-tool config, kept with routing config
// rather than as a static on the page component. See webmcp/declarative.js
// for why (Split.tsx doesn't preserve component statics it doesn't know
// about; the route table isn't touched by Split at all).
const routes = [
    {
        path: "/",
        end: true,
        component: Home,
    },
    {
        path: "/products",
        component: ProductList,
        tool: {
            description:
                "Browse the product catalogue. Optionally filter by category and/or a maximum price (INR). " +
                "Returns by navigating to the filtered listing.",
            searchParams: {
                category: {
                    type: "string",
                    enum: ["footwear", "electronics", "apparel"],
                    description: "restrict to one product category",
                },
                maxPrice: {
                    type: "number",
                    description: "only show products at or below this price, in INR (e.g. 3000)",
                },
            },
            annotations: { readOnlyHint: true },
        },
    },
    {
        path: "/product/:id",
        component: ProductDetail,
        tool: {
            description:
                "Open a specific product's detail page by its id (slug), e.g. \"trail-runner-x\". " +
                "Ids come from the product listing.",
            annotations: { readOnlyHint: true },
        },
    },
    {
        path: "/cart",
        component: Cart,
    },
]

export default routes
