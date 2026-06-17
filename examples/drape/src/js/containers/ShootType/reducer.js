import { createSlice } from "@reduxjs/toolkit"

const initialState = {
    selectedShootType: "studio",
    modelPreference: "female",
    variantCount: 6,
}

export const shootTypeSlice = createSlice({
    name: "shootType",
    initialState,
    reducers: {
        setShootType: (state, action) => {
            state.selectedShootType = action.payload
        },
        setModelPreference: (state, action) => {
            state.modelPreference = action.payload
        },
        incrementVariants: (state) => {
            // TODO: API — replace 12 with backend-provided maxVariants when /shoot-types ships
            if (state.variantCount < 12) state.variantCount += 1
        },
        decrementVariants: (state) => {
            if (state.variantCount > 1) state.variantCount -= 1
        },
    },
})

export const { setShootType, setModelPreference, incrementVariants, decrementVariants } =
    shootTypeSlice.actions
export const shootTypeReducer = shootTypeSlice.reducer
