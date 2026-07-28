import { defineApi } from "catalyst-core/api"
import { getDogBreeds, getDogImages } from "../../src/js/utils/dogApi.js"

const listBreeds = defineApi({
    method: "GET",
    path: "/api/breeds/list/all",
    handler: () => getDogBreeds(),
})

const breedImages = defineApi({
    method: "GET",
    path: "/api/breed/:breed/images",
    handler: () => getDogImages(),
})

export default [listBreeds, breedImages]
