const fetchFunction = (url, options) => {
    // Node's fetch can't resolve a relative URL the way a browser does — SSR
    // needs an absolute base pointing back at this same server. The browser
    // can just use API_URL (empty string here, i.e. same-origin relative).
    const baseURL =
        typeof window === "undefined"
            ? `http://${process.env.NODE_SERVER_HOSTNAME}:${process.env.NODE_SERVER_PORT}`
            : process.env.API_URL
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
