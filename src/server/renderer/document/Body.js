import React from "react"
import PropTypes from "prop-types"

/**
 * Body component which will be used in page component
 * @param {object} jsx - page jsx code
 * @param {object} initialState - initial state object for redux store
 * @param {object} firstFoldCss - style elements extracted for initial page load
 * @param {object} fetcherData - contains data from executing serverFetcher function
 * @param {object} children - contains any child elements defined within the component
 */
export function Body(props) {
    const { jsx = "", initialState = {}, fetcherData = {}, children } = props
    return (
        <body>
            {jsx}
            <script
                /* eslint-disable */
                dangerouslySetInnerHTML={{
                    __html: `
                    window.__INITIAL_STATE__ = ${JSON.stringify(initialState)}
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
    jsx: PropTypes.any,
    fetcherData: PropTypes.object,
    children: PropTypes.node,
}
