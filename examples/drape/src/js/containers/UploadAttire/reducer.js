import { createSlice } from "@reduxjs/toolkit"

const initialState = {
    photos: [],
    attireType: null,
    fabric: null,
}

export const uploadAttireSlice = createSlice({
    name: "uploadAttire",
    initialState,
    reducers: {
        addPhoto: (state, action) => {
            state.photos.push(action.payload)
        },
        removePhoto: (state, action) => {
            state.photos = state.photos.filter((p) => p.id !== action.payload)
        },
        setAttireType: (state, action) => {
            state.attireType = action.payload
        },
        setFabric: (state, action) => {
            state.fabric = action.payload
        },
    },
})

export const { addPhoto, removePhoto, setAttireType, setFabric } = uploadAttireSlice.actions
export const uploadAttireReducer = uploadAttireSlice.reducer
