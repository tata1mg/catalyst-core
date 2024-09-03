import React from "react"
import PropTypes from "prop-types"

/**
 * Body component which will be used in page component
 * @param {object} jsx - page jsx code
 * @param {object} initialState - initial state object for redux store
 * @param {object} firstFoldCss - style elements extracted for initial page load
 * @param {object} firstFoldJS - javascript elements extracted for initial page load
 * @param {object} fetcherData - contains data from executing serverFetcher function
 * @param {object} children - contains any child elements defined within the component
 */
export function Body(props) {
    const {
        jsx = "",
        initialState = {},
        firstFoldCss = "",
        firstFoldJS = "",
        fetcherData = {},
        children,
    } = props
    return (
        <body>
            {typeof firstFoldCss === "string" ? (
                <style dangerouslySetInnerHTML={{ __html: firstFoldCss }} />
            ) : (
                firstFoldCss
            )}
            {jsx}
            {/* {firstFoldJS} */}
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
    firstFoldCss: PropTypes.any,
    firstFoldJS: PropTypes.any,
    jsx: PropTypes.any,
    fetcherData: PropTypes.object,
    children: PropTypes.node,
}
