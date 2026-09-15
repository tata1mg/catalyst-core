import React, { useState } from "react"
import { Link } from "react-router"
import { useSelector, useDispatch } from "react-redux"
import { useTool } from "@webmcp"
import { selectCartItems, selectCartTotal, clearCart, removeFromCart } from "../../store/cartSlice"
import css from "./Cart.scss"

function Cart() {
    const dispatch = useDispatch()
    const cartItems = useSelector(selectCartItems)
    const grandTotal = useSelector(selectCartTotal)
    const [orderMessage, setOrderMessage] = useState("")

    useTool({
        name: "checkout",
        description: "Place the order for everything in the cart.",
        inputSchema: {
            type: "object",
            properties: {},
        },
        execute: async () => {
            dispatch(clearCart())
            return "Order placed successfully! Cart has been cleared."
        },
    })

    const handleCheckout = () => {
        dispatch(clearCart())
        setOrderMessage("Order placed successfully! Thank you for your purchase.")
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
                                {cartItems.map(({ id, product, quantity, lineTotal }) => (
                                    <tr key={id} className={css.tr}>
                                        <td className={css.td}>
                                            <div className={css.productName}>{product.name}</div>
                                            <div className={css.productCategory}>{product.category}</div>
                                        </td>
                                        <td className={css.tdRight}>{quantity}</td>
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
