import React, { useState } from "react"
import { useParams, Link } from "react-router"
import { useSelector, useDispatch } from "react-redux"
import { useTool, WebMcpError, WEBMCP_ERROR_CODES } from "catalyst-core/webmcp"
import { selectProducts } from "../../store/productsSlice"
import { addToCart } from "../../store/cartSlice"
import css from "./ProductDetail.scss"

function ProductDetail() {
    const { id } = useParams()
    const dispatch = useDispatch()
    const products = useSelector(selectProducts)
    const product = (products || []).find((p) => p.id === id)

    const [quantity, setQuantity] = useState(1)
    const [selectedSize, setSelectedSize] = useState(null)
    const [feedback, setFeedback] = useState("")

    const hasSizes = !!(product && product.sizes && product.sizes.length)
    const sizes = (product && product.sizes) || []

    // Size-gated: when the product has sizes, `size` is optional in the
    // schema (not `required` — the shopper's own UI selection is a valid
    // source) but execute() rejects the call if neither an explicit `size`
    // arg nor a UI-selected one is available. deps: [product.id, hasSizes] —
    // NOT selectedSize: the schema/description don't depend on which size is
    // picked, only on whether the product HAS sizes at all, and execute()
    // already reads the live selectedSize via specRef on every call
    // regardless of deps. Including it here would trigger a pointless
    // backend re-register on every dropdown pick (registry.updateToolSpec's
    // deep-equal guard would no-op it, but there's no reason to even ask).
    useTool(
        {
            name: "add_to_cart",
            description: hasSizes
                ? "Add the current product to the cart. Increments any existing quantity for this size — " +
                  "call get_cart to confirm the result, don't assume. This product requires a size: pass one, " +
                  "or the shopper's currently selected size on the page is used if you omit it."
                : "Add the current product to the cart. Increments any existing quantity — call get_cart to " +
                  "confirm the result, don't assume.",
            inputSchema: {
                type: "object",
                properties: {
                    quantity: { type: "number", minimum: 1 },
                    ...(hasSizes ? { size: { type: "string", enum: sizes, description: "size to add" } } : {}),
                },
            },
            execute: async ({ quantity: qty = 1, size } = {}) => {
                if (!product) {
                    // The route matched (/product/:id) but no product with this id
                    // exists — e.g. an agent invented an id it never got from
                    // `products`/`get_cart`. Surfacing this as a typed error (not a
                    // "successful" string result) lets the agent distinguish
                    // "nothing happened, try a different id" from "it worked."
                    throw new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
                        message: `No product found with id "${id}". Call products() to see valid ids.`,
                    })
                }
                const chosenSize = size != null ? size : selectedSize
                if (hasSizes && !chosenSize) {
                    throw new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
                        message: `"${product.name}" requires a size. Pass one of: ${sizes.join(", ")}.`,
                    })
                }
                if (hasSizes && !sizes.includes(chosenSize)) {
                    throw new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
                        message: `"${chosenSize}" is not a valid size for "${product.name}". One of: ${sizes.join(", ")}.`,
                    })
                }
                dispatch(addToCart({ id: product.id, quantity: qty, size: hasSizes ? chosenSize : null }))
                const note = hasSizes
                    ? `Added ${qty}× ${product.name} (size ${chosenSize}) to cart.`
                    : `Added ${qty}× ${product.name} to cart.`
                return { id: product.id, addedQuantity: qty, size: hasSizes ? chosenSize : null, note }
            },
        },
        [product && product.id, hasSizes]
    )

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
        if (hasSizes && !selectedSize) {
            setFeedback("Please select a size first.")
            return
        }
        dispatch(addToCart({ id: product.id, quantity, size: hasSizes ? selectedSize : null }))
        setFeedback(
            hasSizes
                ? `Added ${quantity}× ${product.name} (size ${selectedSize}) to cart!`
                : `Added ${quantity}× ${product.name} to cart!`
        )
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

                {hasSizes && (
                    <div className={css.actions}>
                        <label htmlFor="size-select" className={css.qtyLabel}>
                            Size:
                        </label>
                        <select
                            id="size-select"
                            className={css.qtyInput}
                            value={selectedSize || ""}
                            onChange={(e) => setSelectedSize(e.target.value || null)}
                        >
                            <option value="">Select size</option>
                            {sizes.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

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

// Declarative WebMCP tool config now lives on the route (routes/index.js),
// not here — see webmcp/declarative.js for why.

export default ProductDetail
