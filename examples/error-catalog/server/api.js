const fetchFunction = (url, options) => {
    return fetch(url, options).then((res) => res.json())
}

export default fetchFunction
