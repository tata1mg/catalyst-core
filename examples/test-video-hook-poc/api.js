const fetchFunction = (url, options = {}) => {
    const baseURL = process.env.API_URL
    if (!baseURL) {
        throw new Error('API_URL environment variable is not defined')
    }
    const finalUrl = new URL(url, baseURL).toString()

    // Request Interceptor -  modify request here

    const { timeout = 10000, retries = 3, ...fetchOptions } = options

    const executeFetch = (attempt) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        return fetch(finalUrl, { ...fetchOptions, signal: controller.signal })
            .then(response => {
                clearTimeout(timeoutId)

                if (!response.ok) {
                    const contentType = response.headers.get("content-type")
                    if (contentType && contentType.includes("application/json")) {
                        return response.json().then(errData => {
                            const err = new Error(errData?.message || `Request failed with status ${response.status}`)
                            err.status = response.status
                            err.data = errData
                            throw err
                        })
                    } else {
                        return response.text().then(textData => {
                            const err = new Error(textData || `Request failed with status ${response.status}`)
                            err.status = response.status
                            err.data = textData
                            throw err
                        })
                    }
                }

                const contentType = response.headers.get("content-type")
                if (contentType && contentType.includes("application/json")) {
                    return response.json().then(parsedResponse => {
                        // Response Interceptor -  modify response here
                        return parsedResponse
                    })
                } else {
                    return response.text().then(parsedResponse => {
                        // Response Interceptor -  modify response here
                        return parsedResponse
                    })
                }
            })
            .catch(error => {
                clearTimeout(timeoutId)

                if (attempt < retries) {
                    return executeFetch(attempt + 1)
                }
                throw error
            })
    }

    return executeFetch(1)
}

export default fetchFunction
