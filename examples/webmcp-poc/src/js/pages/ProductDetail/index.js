import React, { useState } from "react"
import { useParams, Link } from "react-router"
import { useSelector, useDispatch } from "react-redux"
import { useTool } from "@webmcp"
import { selectProducts } from "../../store/productsSlice"
import { addToCart } from "../../store/cartSlice"
import css from "./ProductDetail.scss"

function ProductDetail() {
    const { id } = useParams()
    const dispatch = useDispatch()
    const products = useSelector(selectProducts)
    const product = (products || []).find((p) => p.id === id)

    const [quantity, setQuantity] = useState(1)
    const [feedback, setFeedback] = useState("")

    useTool({
        name: "add_to_cart",
        description: "Add the current product to the cart.",
        inputSchema: {
            type: "object",
            properties: {
                quantity: {
                    type: "number",
                    minimum: 1,
                },
            },
        },
        execute: async ({ quantity = 1 } = {}) => {
            if (!product) return "Product not found."
            dispatch(addToCart({ id: product.id, quantity }))
            return `Added ${quantity}× ${product.name} to cart.`
        },
    })

    if (!product) {
        return (
            <div className={css.page}>
                <header className={css.header}>
                    <h1 className={css.title}>Product Not Found</h1>
                    <nav className={css.nav}>
                        <Link className={css.navLink} to="/products">
                            Back to Products
                        </Link>
                    </nav>
                </header>
                <div className={css.notFound}>
                    <p>No product found with ID: &quot;{id}&quot;</p>
                    <Link className={css.navLink} to="/products">
                        Browse all products
                    </Link>
                </div>
            </div>
        )
    }

    const handleAddToCart = () => {
        dispatch(addToCart({ id: product.id, quantity }))
        setFeedback(`Added ${quantity}× ${product.name} to cart!`)
    }

    return (
        <div className={css.page}>
            <header className={css.header}>
                <nav className={css.nav}>
                    <Link className={css.navLink} to="/products">
                        &larr; Back to Products
                    </Link>
                </nav>
                <nav className={css.nav}>
                    <Link className={css.navLink} to="/">
                        Home
                    </Link>
                    <span>|</span>
                    <Link className={css.navLink} to="/cart">
                        Cart
                    </Link>
                </nav>
            </header>

            <div className={css.card}>
                <div className={css.productHeader}>
                    <h1 className={css.productName}>{product.name}</h1>
                    <span className={css.categoryTag}>{product.category}</span>
                </div>

                <div className={css.price}>₹{product.price}</div>
                <p className={css.description}>{product.description}</p>

                <div className={css.actions}>
                    <label htmlFor="quantity-input" className={css.qtyLabel}>
                        Quantity:
                    </label>
                    <input
                        id="quantity-input"
                        type="number"
                        min="1"
                        className={css.qtyInput}
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    />
                    <button
                        type="button"
                        className={css.addBtn}
                        onClick={handleAddToCart}
                    >
                        Add to cart
                    </button>
                </div>

                {feedback && <div className={css.feedback}>{feedback}</div>}
            </div>
        </div>
    )
}

/**
 * Declarative WebMCP read tool. WebMcpProvider derives:
 *   name         "product"                 (from the route path /product/:id)
 *   inputSchema  { id: string (required) } (from the :id path param)
 *   execute      navigate("/product/<id>"), then report
 * Note the imperative `add_to_cart` tool (useTool, above) only exists while a
 * ProductDetail is mounted — so an agent typically calls this `product` tool
 * first to land on a page, then `add_to_cart`.
 */
// Static SEO metadata. A production page would build this from the fetched
// product (serverFetcher → routeData), so title/description name the actual
// item; this POC reads products from Redux, so setMetaData can't see the id and
// stays generic. get_page_info surfaces whatever is here.
ProductDetail.setMetaData = () => [
    <title key="t">Product details — WebMCP POC</title>,
    <meta key="d" name="description" content="Full details, price and add-to-cart for a single product." />,
]

ProductDetail.tool = {
    description:
        "Open a specific product's detail page by its id (slug), e.g. \"trail-runner-x\". " +
        "Ids come from the product listing.",
    annotations: { readOnlyHint: true },
}

export default ProductDetail
