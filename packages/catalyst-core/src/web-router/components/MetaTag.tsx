import React, { useContext, useState, useEffect, useRef } from "react"
import { OneMgRouterContext } from "../context.jsx"
import { useRouterData } from "./RouterDataProvider.jsx"
import { getMetaData } from "../utils/metaDataUtils.jsx"
import { useLocation } from "react-router"

/**
 * @description renders meta tags component assigned to setMetaData
 */
export const MetaTag = (): any => {
    const { matchedRoutes } = useContext(OneMgRouterContext)
    const routeData = useRouterData()
    const location = useLocation()
    // null until the first client update, so server and hydration renders match (both empty).
    const [metaTags, setMetaTags] = useState<any[] | null>(null)
    // The server renders these tags into <head> (Head.tsx). React 19 does not
    // adopt them when MetaTag renders its own copies, and renders non-metadata
    // tags such as <script type="application/ld+json"> in place, so the server
    // copies would outlive the page they describe. Captured on mount, before
    // any client copy exists, and removed once the client copies are in.
    const serverTags = useRef<Element[] | null>(null)

    useEffect(() => {
        serverTags.current ??= Array.from(document.head.querySelectorAll("[data-catalyst]"))
        const mergedMetaTags = getMetaData(matchedRoutes, routeData)
        setMetaTags(Array.isArray(mergedMetaTags) ? mergedMetaTags : [])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location])

    useEffect(() => {
        if (!metaTags || !serverTags.current?.length) return
        serverTags.current.forEach((el) => el.remove())
        serverTags.current = []
    }, [metaTags])

    // React 19 hoists document metadata rendered by components into <head>.
    return <>{metaTags}</>
}
