const stringToKebabCase = (value) => value.split(' ').join('-').toLowerCase()

const kebabCasetoString = (value) => {
    const convertedString = value.split('-').join(' ')
    return convertedString[0].toUpperCase() + convertedString.substring(1)
}

const stringToSnakeCase = (value) => value.split(' ').join('_').toLowerCase()

const snakeCaseToString = (value) => {
    const convertedString = value.split('_').join(' ')
    return convertedString[0].toUpperCase() + convertedString.substring(1)
}

const kebabCaseToSnakeCase = (value) => value.split('-').join('_')

const filterRoutes = (serviceList, body) => {
    // Function to filter out checked route and give the service list with hidden routes
    // if a service is completely hidden then the service entry will be absent in final result
    const result = {}

    for (const [service, routes] of Object.entries(serviceList)) {
        const bodyRoutes = body[service] || []
        if (bodyRoutes?.length > 0) {
            const filteredRoutes = routes.routes.filter(
                (route) => !bodyRoutes.includes(route)
            )
            if (filteredRoutes.length > 0) {
                result[service] = filteredRoutes
            } else {
                result[service] = filteredRoutes
            }
        }
    }

    return result
}

const stringToCamelCase = (value) =>
    value
        .split(' ')
        .map((item, idx) =>
            idx === 0
                ? item.toLowerCase()
                : item.charAt(0).toUpperCase() + item.slice(1)
        )
        .join('')

const epochTime = () => {
    return Math.ceil(Date.now() / 1000)
}

const eachWordCamelCaseFromString = (value) =>
    value
        ?.split(' ')
        .map(
            (item) =>
                item?.charAt(0)?.toUpperCase() + item?.slice(1)?.toLowerCase()
        )
        .join(' ')

module.exports = {
    stringToKebabCase,
    kebabCasetoString,
    stringToSnakeCase,
    snakeCaseToString,
    kebabCaseToSnakeCase,
    filterRoutes,
    stringToCamelCase,
    epochTime,
    eachWordCamelCaseFromString,
}
