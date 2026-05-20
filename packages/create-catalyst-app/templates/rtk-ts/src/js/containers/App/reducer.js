import { createSlice } from "@reduxjs/toolkit"

const initialState = {
    testActionDispatched: false,
}

export const appSlice = createSlice({
    name: "shellReducer",
    initialState: initialState,
    reducers: {
        reduxTest: (state) => {
            state.testActionDispatched = true
        },
    },
})

export const { reduxTest } = appSlice.actions
export const shellReducer = appSlice.reducer
