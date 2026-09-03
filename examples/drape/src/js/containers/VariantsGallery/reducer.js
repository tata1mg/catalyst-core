import { createSlice } from "@reduxjs/toolkit"

// TODO: API — replace with GET /jobs/:id/variants once the backend ships.
const PLACEHOLDER_VARIANTS = [
    { id: "v1", url: "/static/variants-gallery/v1.png" },
    { id: "v2", url: "/static/variants-gallery/v2.png" },
    { id: "v3", url: "/static/variants-gallery/v3.png" },
    { id: "v4", url: "/static/variants-gallery/v4.png" },
    { id: "v5", url: "/static/variants-gallery/v5.png" },
    { id: "v6", url: "/static/variants-gallery/v6.png" },
]

const initialState = {
    variants: PLACEHOLDER_VARIANTS,
    selectedVariantId: "v1",
    highResCount: 4,
}

export const variantsGallerySlice = createSlice({
    name: "variantsGallery",
    initialState,
    reducers: {
        selectVariant: (state, action) => {
            state.selectedVariantId = action.payload
        },
        regenerate: (state) => {
            state.selectedVariantId = state.variants[0]?.id || null
        },
    },
})

export const { selectVariant, regenerate } = variantsGallerySlice.actions
export const variantsGalleryReducer = variantsGallerySlice.reducer
