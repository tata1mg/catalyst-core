import { defineApi } from "catalyst-core/api"
import { getDogImages, getRelatedBreeds } from "../../src/js/utils/dogApi.js"

export const getBreedImages = defineApi({
    method: "GET",
    path: "/api/breed/:breed/images",
    handler: async () => getDogImages(),
})

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Artificial delay — makes BreedDetails' deferred `relatedBreeds` field
// actually observable as a streamed-in-after-the-shell value instead of
// resolving too fast to tell apart from critical data.
export const getBreedsRelated = defineApi({
    method: "GET",
    path: "/api/breeds/related/:breed",
    handler: async ({ params }) => {
        await wait(300)
        return getRelatedBreeds(params.breed)
    },
})

export default [getBreedImages, getBreedsRelated]
