import { createSlice } from "@reduxjs/toolkit"

const initialState = {
    items: [
        {
            id: "trail-runner-x",
            name: "Trail Runner X",
            price: 2799,
            category: "footwear",
            description: "Lightweight trail running shoes with aggressive grip and breathable mesh.",
        },
        {
            id: "cloud-strider-pro",
            name: "Cloud Strider Pro",
            price: 3899,
            category: "footwear",
            description: "High-cushion road running shoes engineered for distance comfort.",
        },
        {
            id: "urban-leather-loafer",
            name: "Urban Leather Loafer",
            price: 4499,
            category: "footwear",
            description: "Handcrafted genuine leather loafers with slip-on silhouette.",
        },
        {
            id: "aerosound-wireless-anc",
            name: "AeroSound ANC Headphones",
            price: 6999,
            category: "electronics",
            description: "Over-ear wireless headphones with active noise cancellation and 40h battery.",
        },
        {
            id: "pulsetrack-smartband",
            name: "PulseTrack Smart Band",
            price: 2499,
            category: "electronics",
            description: "Fitness tracker with AMOLED display, continuous heart rate and SpO2 monitor.",
        },
        {
            id: "sonicboom-mini-speaker",
            name: "SonicBoom Mini Speaker",
            price: 1799,
            category: "electronics",
            description: "Portable IPX7 waterproof Bluetooth speaker with 360-degree deep bass.",
        },
        {
            id: "merino-thermal-hoodie",
            name: "Merino Thermal Hoodie",
            price: 3299,
            category: "apparel",
            description: "Temperature-regulating merino wool blend hoodie with kangaroo pocket.",
        },
        {
            id: "dryfit-training-tee",
            name: "DryFit Performance Tee",
            price: 899,
            category: "apparel",
            description: "Moisture-wicking athletic tee built with 4-way stretch fabric.",
        },
    ],
}

export const productsSlice = createSlice({
    name: "products",
    initialState,
    reducers: {},
})

export const selectProducts = (state) => state.products.items

export default productsSlice.reducer
