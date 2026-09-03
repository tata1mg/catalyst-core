const fetchFunction = (url, options) => {
    let baseURL = process.env.API_URL
    let finalUrl = baseURL + url

    // Request Interceptor -  modify request here

    return fetch(finalUrl, options)
        .then(response => {
            return response.json().then(parsedResponse => {
                // Response Interceptor -  modify response here
                return parsedResponse
            })
        })
}

export default fetchFunction
