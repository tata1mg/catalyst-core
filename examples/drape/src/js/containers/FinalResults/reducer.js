import { createSlice } from "@reduxjs/toolkit"

// TODO: API — replace with GET /jobs/:id/result once the backend ships.
const PLACEHOLDER_RESULT = {
    featured: {
        id: "r-featured",
        url: "/static/final-results/featured.png",
        descriptor: "Studio · Red silk saree · 4K",
    },
    siblings: [
        { id: "r-1", url: "/static/final-results/thumb-1.png" },
        { id: "r-2", url: "/static/final-results/thumb-2.png" },
        { id: "r-3", url: "/static/final-results/thumb-3.png" },
        { id: "r-4", url: "/static/final-results/thumb-4.png" },
    ],
}

const initialState = {
    featured: PLACEHOLDER_RESULT.featured,
    siblings: PLACEHOLDER_RESULT.siblings,
    selectedSiblingId: "r-1",
    bookmarked: false,
}

export const finalResultsSlice = createSlice({
    name: "finalResults",
    initialState,
    reducers: {
        selectSibling: (state, action) => {
            state.selectedSiblingId = action.payload
        },
        toggleBookmark: (state) => {
            state.bookmarked = !state.bookmarked
        },
    },
})

export const { selectSibling, toggleBookmark } = finalResultsSlice.actions
export const finalResultsReducer = finalResultsSlice.reducer
