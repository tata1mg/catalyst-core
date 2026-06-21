import React from "react"
/**
 * Merges multiple lists of head elements, ensuring that later lists override earlier ones in case of duplicates.
 * Handles all types of head elements, including title, meta, link, etc.
 *
 * @param {...Array<JSX.Element>} lists - Multiple lists of JSX head elements, where the first argument is the parent and the rest are children in order.
 * @returns {Array<JSX.Element>} - The combined list with later lists overriding duplicates from earlier ones.
 */
export function mergeHeadElements(...lists) {
    const elementMap = new Map()

    /**
     * Function to get a unique key for a head element based on its type and attributes.
     * @param {JSX.Element} element - The head element from which to derive a key.
     * @returns {string} - A unique key representing the element.
     */
    const getKey = (element) => {
        const { type, props } = element

        if (type === "title") {
            return "title" // Only one title should exist in a document
        }

        // For meta tags, use 'name' or 'property' as unique identifiers
        if (type === "meta") {
            if (props.charset) {
                return "charset" // Charset should be unique in a document
            }
            return props.name || props.property || props["http-equiv"] || props.httpEquiv || ""
        }

        // For link tags, use 'rel' as a unique identifier
        // if (type === "link") {
        //   return props.rel || "";
        // }

        // Create a unique representation for other types of elements
        return `${type}:${Object.entries(props)
            .map(([key, value]) => `${key}=${value}`)
            .join(",")}`
    }

    // Loop through all the lists, ensuring later lists override earlier ones
    lists?.forEach((list) => {
        list?.forEach((element) => {
            const key = getKey(element)
            if (key) {
                elementMap.set(key, element) // Overwrite earlier elements with later ones
            }
        })
    })

    // Return the combined list of head elements
    return Array.from(elementMap.values())
}

/**
 * Deletes all elements in the head with a specific data attribute.
 *
 * @param {string} attributeName - The name of the data attribute to search for.
 * @param {string} [attributeValue] - The specific value of the data attribute to match (optional).
 */
export function deleteHeadTagsByDataAttribute(attributeName, attributeValue) {
    const head = document.head
    const tagsToDelete = []

    // Iterate over all children in the head section
    Array.from(head.children).forEach((element) => {
        const hasAttribute = element.hasAttribute(`data-${attributeName}`)

        // If a specific attribute value is provided, check for it
        if (attributeValue && hasAttribute) {
            const matchesValue = element.getAttribute(`data-${attributeName}`) === attributeValue
            if (matchesValue) {
                tagsToDelete.push(element)
            }
        } else if (hasAttribute) {
            // If no specific value, just check if the attribute is present
            tagsToDelete.push(element)
        }
    })

    // Delete all the tags that matched the attribute condition
    tagsToDelete.forEach((tag) => {
        head.removeChild(tag)
    })
}

/**
 * Returns resolved array of meta data elements.
 *
 *
 * @param {Array<Match>} matchedRoutes  - Array of all matches.
 * @param {Object} routeData  - Data returned from Router.
 * @returns {Array<JSX.Element>} - List of all meta tags for the matched location.
 */

export function getMetaData(matchedRoutes, routeData) {
    let allTags = []
    try {
        matchedRoutes?.forEach?.((match) => {
            const setMetaData = match?.route?.component?.setMetaData
            if (setMetaData) {
                let tags = setMetaData(routeData)
                allTags = [...allTags, tags]
            }
        })
        if (Array.isArray(allTags) && allTags.length > 0) {
            let mergedTags = mergeHeadElements(...allTags)
            allTags = mergedTags.map((el,index)=>React.cloneElement(el,{"data-catalyst":true,key:index}))
        }
    } catch (er) {
        console.log("meta tags error is ===>", er)
    }

    return allTags
}
