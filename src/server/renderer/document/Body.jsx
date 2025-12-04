import React from "react"
import PropTypes from "prop-types"
import path from "path"

/**
 * Serialize postponed state safely for injection into HTML
 * @param {object} postponed - PPR postponed state
 * @returns {string} - JSON string or empty string if null
 */
const serializePostponed = (postponed) => {
    if (!postponed) return "null"
    try {
        return JSON.stringify(postponed)
    } catch (error) {
        console.error("Error serializing PPR postponed state:", error)
        return "null"
    }
}

/**
 * Body component which will be used in page component
 * @param {object} jsx - page jsx code
 * @param {object} statusCode - document request status code
 * @param {object} initialState - initial state object for redux store
 * @param {object} fetcherData - contains data from executing serverFetcher function
 * @param {object} pprPostponed - PPR postponed state for client hydration
 * @param {object} children - contains any child elements defined within the component
 */
export function Body(props) {
    const {
        jsx = "",
        statusCode = "",
        initialState = {},
        fetcherData = {},
        pprPostponed = null,
        children,
    } = props

    const isPPREnabled = process.env.ENABLE_PPR === "true"

    return (
        <body>
            {process.env.NODE_ENV === "development" && (
                <script type="module" src={path.resolve(process.env.src_path, "client/index.jsx")}></script>
            )}
            {jsx}
            <script
                /* eslint-disable */
                dangerouslySetInnerHTML={{
                    __html: `
                    window.__INITIAL_STATE__ = ${JSON.stringify(initialState)}
                    window.__STATUS_CODE__ = ${statusCode}
                    window.__ROUTER_INITIAL_DATA__ = ${JSON.stringify(fetcherData)}
                    ${isPPREnabled ? `window.__PPR_ENABLED__ = true` : ""}
                    ${pprPostponed ? `window.__PPR_POSTPONED__ = ${serializePostponed(pprPostponed)}` : ""}
            `,
                }}
            />

            {children}
        </body>
    )
}

Body.propTypes = {
    initialState: PropTypes.object,
    jsx: PropTypes.any,
    statusCode: PropTypes.string,
    fetcherData: PropTypes.object,
    pprPostponed: PropTypes.object,
    children: PropTypes.node,
}
