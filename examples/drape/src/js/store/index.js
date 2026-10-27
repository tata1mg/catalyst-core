import { configureStore as createStore } from "@reduxjs/toolkit"
import { combineReducers } from "redux"
import { shellReducer } from "@containers/App/reducer.js"
import { uploadAttireReducer } from "@containers/UploadAttire/reducer.js"
import { shootTypeReducer } from "@containers/ShootType/reducer.js"
import { generatingReducer } from "@containers/Generating/reducer.js"
import { variantsGalleryReducer } from "@containers/VariantsGallery/reducer.js"
import { finalResultsReducer } from "@containers/FinalResults/reducer.js"
import fetchInstance from "@api"

const configureStore = (initialState) => {
    const api = fetchInstance
    const store = createStore({
        reducer: combineReducers({
            shellReducer,
            uploadAttireReducer,
            shootTypeReducer,
            generatingReducer,
            variantsGalleryReducer,
            finalResultsReducer,
        }),
        middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
                thunk: {
                    extraArgument: { api },
                },
            }),
        preloadedState: initialState,
    })
    return store
}

export default configureStore
