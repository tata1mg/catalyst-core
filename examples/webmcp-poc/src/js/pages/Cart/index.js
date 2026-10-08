import React, { useState } from "react"
import { Link } from "react-router"
import { useSelector, useDispatch } from "react-redux"
import { useTool } from "catalyst-core/webmcp"
import {
    selectCartItems,
    selectCartTotal,
    clearCart,
    removeFromCart,
    updateQuantity,
} from "../../store/cartSlice"
import css from "./Cart.scss"

function Cart() {
    const dispatch = useDispatch()
    const cartItems = useSelector(selectCartItems)
    const grandTotal = useSelector(selectCartTotal)
    const [orderMessage, setOrderMessage] = useState("")

    // Retry-safe: an empty cart is a valid (not exceptional) checkout state,
    // so a retry that lands after a first call already cleared the cart gets
    // a distinguishable, non-throwing result instead of an error.
    useTool({
        name: "checkout",
        description: "Place the order for everything in the cart. Safe to retry.",
        inputSchema: {
            type: "object",
            properties: {},
        },
        execute: async () => {
            if (cartItems.length === 0) {
                return { placed: false, note: "Cart is already empty — nothing to check out." }
            }
            const orderId = `order_${Date.now().toString(36)}`
            dispatch(clearCart())
            return { placed: true, orderId, note: "Order placed successfully! Cart has been cleared." }
        },
    })

    // Stateful action tools — their inputSchema's `id` enum and description
    // must track the CURRENT cart contents, so they pass a `deps` array.
    // useTool swaps description/inputSchema in place on every cart change
    // (registry.updateToolSpec) rather than tearing the registration down and
    // rebuilding it — a remove_from_cart or update_quantity call already in
    // flight when the cart changes still completes against the same
    // registration.
    const cartItemIds = cartItems.map((i) => i.id)
    // enum: [] is an unsatisfiable schema a native backend may reject at
    // registerTool — omit the constraint entirely on an empty cart instead.
    const idProp = cartItemIds.length
        ? { type: "string", enum: cartItemIds, description: "product id" }
        : { type: "string", description: "product id (cart is currently empty)" }

    useTool({
        name: "get_cart",
        description: "Read the current contents of the cart: items, quantities, sizes, and the grand total.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => ({
            items: cartItems.map(({ id, product, quantity, size, lineTotal }) => ({
                id,
                name: product.name,
                quantity,
                size,
                unitPrice: product.price,
                lineTotal,
            })),
            grandTotal,
        }),
    })

    useTool(
        {
            name: "remove_from_cart",
            description: "Remove an item from the cart entirely, by product id. Idempotent — safe to retry.",
            inputSchema: {
                type: "object",
                properties: { id: idProp },
                required: ["id"],
            },
            execute: async ({ id } = {}) => {
                if (!cartItemIds.includes(id)) {
                    // Already gone (e.g. a retry after the first call succeeded) —
                    // not an error, just a no-op the agent can see clearly.
                    return { removed: false, note: `"${id}" is not in the cart. Current items: ${cartItemIds.join(", ") || "(none)"}` }
                }
                dispatch(removeFromCart({ id }))
                return { removed: true, id }
            },
        },
        [cartItemIds.join(",")]
    )

    useTool(
        {
            name: "update_quantity",
            description: "Set an item already in the cart to an exact quantity (not an increment). Idempotent — safe to retry.",
            inputSchema: {
                type: "object",
                properties: {
                    id: idProp,
                    quantity: { type: "number", minimum: 1, description: "new quantity; use remove_from_cart to zero it out" },
                },
                required: ["id", "quantity"],
            },
            execute: async ({ id, quantity } = {}) => {
                if (!cartItemIds.includes(id)) {
                    throw new Error(`"${id}" is not in the cart. Current items: ${cartItemIds.join(", ") || "(none)"}`)
                }
                dispatch(updateQuantity({ id, quantity }))
                return { id, quantity }
            },
        },
        [cartItemIds.join(",")]
    )

    const handleCheckout = () => {
        if (cartItems.length === 0) return
        dispatch(clearCart())
        setOrderMessage("Order placed successfully! Thank you for your purchase.")
    }

    const handleQuantityChange = (id, value) => {
        const qty = Math.max(1, parseInt(value, 10) || 1)
        dispatch(updateQuantity({ id, quantity: qty }))
    }

    const handleRemove = (id) => {
        dispatch(removeFromCart({ id }))
    }

    return (
        <div className={css.page}>
            <header className={css.header}>
                <h1 className={css.title}>Shopping Cart</h1>
                <nav className={css.nav}>
                    <Link className={css.navLink} to="/">
                        Home
                    </Link>
                    <span>|</span>
                    <Link className={css.navLink} to="/products">
                        Products
                    </Link>
                </nav>
            </header>

            {orderMessage && <div className={css.orderSuccess}>{orderMessage}</div>}

            <div className={css.card}>
                {cartItems.length === 0 ? (
                    <div className={css.emptyState}>
                        <p>Your cart is currently empty.</p>
                        <Link className={css.navLink} to="/products">
                            Start shopping &rarr;
                        </Link>
                    </div>
                ) : (
                    <>
                        <table className={css.table}>
                            <thead>
                                <tr>
                                    <th className={css.th}>Product</th>
                                    <th className={css.thRight}>Qty</th>
                                    <th className={css.thRight}>Price</th>
                                    <th className={css.thRight}>Line Total</th>
                                    <th className={css.thRight}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {cartItems.map(({ id, product, quantity, size, lineTotal }) => (
                                    <tr key={id} className={css.tr}>
                                        <td className={css.td}>
                                            <div className={css.productName}>
                                                {product.name}
                                                {size ? ` (${size})` : ""}
                                            </div>
                                            <div className={css.productCategory}>{product.category}</div>
                                        </td>
                                        <td className={css.tdRight}>
                                            <input
                                                type="number"
                                                min="1"
                                                aria-label={`Quantity for ${product.name}`}
                                                className={css.qtyInput}
                                                value={quantity}
                                                onChange={(e) => handleQuantityChange(id, e.target.value)}
                                            />
                                        </td>
                                        <td className={css.tdRight}>₹{product.price}</td>
                                        <td className={css.tdRight}>₹{lineTotal}</td>
                                        <td className={css.tdRight}>
                                            <button
                                                type="button"
                                                className={css.removeBtn}
                                                onClick={() => handleRemove(id)}
                                            >
                                                Remove
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div className={css.summary}>
                            <div className={css.totalRow}>
                                <span>Grand Total:</span>
                                <span>₹{grandTotal}</span>
                            </div>
                            <button
                                type="button"
                                className={css.checkoutBtn}
                                onClick={handleCheckout}
                            >
                                Checkout
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

export default Cart
