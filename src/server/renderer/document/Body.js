import React from "react"
import PropTypes from "prop-types"

/**
 * Body component which will be used in page component
 * @param {object} jsx - page jsx code
 * @param {object} statusCode - document request status code
 * @param {object} initialState - initial state object for redux store
 * @param {object} fetcherData - contains data from executing serverFetcher function
 * @param {object} children - contains any child elements defined within the component
 */
export function Body(props) {
    const { jsx, statusCode = "", initialState = {}, fetcherData = {}, children, store, context, req } = props

    return (
        <body>
            {jsx?.(store, context, req, fetcherData)}
            <script
                /* eslint-disable */
                dangerouslySetInnerHTML={{
                    __html: `
                    window.__INITIAL_STATE__ = ${JSON.stringify(initialState)}
                    window.__STATUS_CODE__ = ${statusCode}
                    window.__ROUTER_INITIAL_DATA__ = ${JSON.stringify(fetcherData)}
            `,
                }}
            />

            {children}
        </body>
    )
}

Body.propTypes = {
    initialState: PropTypes.object,
    jsx: PropTypes.func,
    statusCode: PropTypes.number,
    fetcherData: PropTypes.object,
    children: PropTypes.node,
    store: PropTypes.object,
    context: PropTypes.object,
    req: PropTypes.object,
}
