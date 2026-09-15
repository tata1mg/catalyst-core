import { createSlice, createSelector } from "@reduxjs/toolkit"

const initialState = {
    items: {},
}

export const cartSlice = createSlice({
    name: "cart",
    initialState,
    reducers: {
        addToCart: (state, action) => {
            const { id, quantity = 1 } = action.payload || {}
            if (!id) return
            const qty = Math.max(1, parseInt(quantity, 10) || 1)
            state.items[id] = (state.items[id] || 0) + qty
        },
        removeFromCart: (state, action) => {
            const { id } = action.payload || {}
            if (id && state.items[id] !== undefined) {
                delete state.items[id]
            }
        },
        clearCart: (state) => {
            state.items = {}
        },
    },
})

export const { addToCart, removeFromCart, clearCart } = cartSlice.actions

const selectCartState = (state) => (state.cart && state.cart.items) || {}
const selectProductsState = (state) => (state.products && state.products.items) || []

export const selectCartItems = createSelector(
    [selectCartState, selectProductsState],
    (cartItems, products) => {
        const productMap = new Map(products.map((p) => [p.id, p]))

        return Object.entries(cartItems)
            .filter(([id, qty]) => qty > 0 && productMap.has(id))
            .map(([id, qty]) => {
                const product = productMap.get(id)
                return {
                    id,
                    product,
                    quantity: qty,
                    lineTotal: product.price * qty,
                }
            })
    }
)

export const selectCartTotal = createSelector(
    [selectCartItems],
    (items) => items.reduce((total, item) => total + item.lineTotal, 0)
)

export default cartSlice.reducer
