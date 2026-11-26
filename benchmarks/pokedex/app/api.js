// Not used by the pages (they call fetch directly), but kept: catalyst's preflight check requires
// an "@api" module alias in package.json (packages/catalyst-core/src/server/utils/validator.ts).
const fetchFunction = (url, options) => {
    let baseURL = process.env.API_URL
    let finalUrl = baseURL + url

    // Request Interceptor -  modify request here

    return fetch(finalUrl, options).then((response) => {
        return response.json().then((parsedResponse) => {
            // Response Interceptor -  modify response here
            return parsedResponse
        })
    })
}

export default fetchFunction
