import { createSlice } from "@reduxjs/toolkit"

const initialState = {
    progress: 0,
    currentStep: "analyzing",
    completedSteps: [],
    cancelled: false,
}

export const generatingSlice = createSlice({
    name: "generating",
    initialState,
    reducers: {
        setProgress: (state, action) => {
            state.progress = action.payload
        },
        setCurrentStep: (state, action) => {
            state.currentStep = action.payload
        },
        completeStep: (state, action) => {
            if (!state.completedSteps.includes(action.payload)) {
                state.completedSteps.push(action.payload)
            }
        },
        cancelGeneration: (state) => {
            state.cancelled = true
        },
        resetGeneration: () => initialState,
    },
})

export const {
    setProgress,
    setCurrentStep,
    completeStep,
    cancelGeneration,
    resetGeneration,
} = generatingSlice.actions
export const generatingReducer = generatingSlice.reducer
