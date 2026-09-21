import { createSlice, createSelector } from "@reduxjs/toolkit"

const initialState = {
    // keyed by product id -> { quantity, size }. `size` is null for products
    // that don't declare `sizes` (e.g. electronics).
    items: {},
}

export const cartSlice = createSlice({
    name: "cart",
    initialState,
    reducers: {
        addToCart: (state, action) => {
            const { id, quantity = 1, size = null } = action.payload || {}
            if (!id) return
            const qty = Math.max(1, parseInt(quantity, 10) || 1)
            const existing = state.items[id]
            state.items[id] = {
                quantity: (existing ? existing.quantity : 0) + qty,
                size: size != null ? size : existing ? existing.size : null,
            }
        },
        removeFromCart: (state, action) => {
            const { id } = action.payload || {}
            if (id && state.items[id] !== undefined) {
                delete state.items[id]
            }
        },
        // Absolute set, distinct from addToCart's increment — used by both the
        // qty input on the cart page and the update_quantity WebMCP tool.
        updateQuantity: (state, action) => {
            const { id, quantity } = action.payload || {}
            if (!id || !state.items[id]) return
            const qty = parseInt(quantity, 10)
            if (!Number.isFinite(qty) || qty <= 0) {
                delete state.items[id]
                return
            }
            state.items[id].quantity = qty
        },
        clearCart: (state) => {
            state.items = {}
        },
    },
})

export const { addToCart, removeFromCart, updateQuantity, clearCart } = cartSlice.actions

const selectCartState = (state) => (state.cart && state.cart.items) || {}
const selectProductsState = (state) => (state.products && state.products.items) || []

export const selectCartItems = createSelector(
    [selectCartState, selectProductsState],
    (cartItems, products) => {
        const productMap = new Map(products.map((p) => [p.id, p]))

        return Object.entries(cartItems)
            .filter(([id, entry]) => entry && entry.quantity > 0 && productMap.has(id))
            .map(([id, entry]) => {
                const product = productMap.get(id)
                return {
                    id,
                    product,
                    quantity: entry.quantity,
                    size: entry.size,
                    lineTotal: product.price * entry.quantity,
                }
            })
    }
)

export const selectCartTotal = createSelector(
    [selectCartItems],
    (items) => items.reduce((total, item) => total + item.lineTotal, 0)
)

export default cartSlice.reducer
