import React, { useContext, useEffect, useLayoutEffect, useReducer } from "react"
import { useLocation } from "react-router"
import { OneMgRouterContext } from "../context.jsx"
import { useRouterData } from "./RouterDataProvider.jsx"
import { getMetaData } from "../utils/metaDataUtils.jsx"

// <title>{name} | 1mg</title> has an array for children; String(array) would join with commas.
const getTitleText = (children) => React.Children.toArray(children).join("")

const DocumentTitle = ({ value }) => {
    useLayoutEffect(() => {
        document.title = value

        const [, ...duplicateTitleElements] = Array.from(document.head.getElementsByTagName("title"))
        duplicateTitleElements.forEach((element) => element.remove())
    }, [value])

    return null
}

/**
 * @description renders meta tags component assigned to setMetaData
 */
export const MetaTag = () => {
    const { matchedRoutes } = useContext(OneMgRouterContext)
    const routeData = useRouterData()
    const location = useLocation()
    const [, rerender] = useReducer((count) => count + 1, 0)

    // A split() route only gains setMetaData once its chunk has loaded, and nothing guarantees
    // that before this component renders (a client navigation can reach a route whose chunk is
    // not loaded yet). load() copies the statics onto the route component and is cached once
    // resolved, so re-render when it settles to pick setMetaData up.
    useEffect(() => {
        let current = true
        const loads = (matchedRoutes || [])
            .map((match) => match?.route?.component)
            .filter((component) => typeof component?.load === "function")
            .map((component) => component.load())
        if (loads.length) {
            Promise.allSettled(loads).then(() => {
                if (current) rerender()
            })
        }
        return () => {
            current = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location])

    const metaTags = getMetaData(matchedRoutes, routeData)

    const titleTag = metaTags.find((tag) => tag.type === "title")
    const nonTitleMetaTags = metaTags.filter((tag) => tag.type !== "title")

    // React 19 does not reconcile titles emitted by the server document with client-side route changes.
    // Update the browser's canonical title instead of rendering another hoisted <title> element.
    return (
        <>
            {titleTag && <DocumentTitle value={getTitleText(titleTag.props.children)} />}
            {nonTitleMetaTags}
        </>
    )
}
