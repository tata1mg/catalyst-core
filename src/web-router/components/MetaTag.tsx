import React, { useContext, useState, useEffect } from "react"
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
    const [metaTags, setMetaTags] = useState<any[]>([])

    useEffect(() => {
        const mergedMetaTags = getMetaData(matchedRoutes, routeData)
        setMetaTags(Array.isArray(mergedMetaTags) ? mergedMetaTags : [])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location])

    // React 19 hoists document metadata rendered by components into <head>.
    return <>{metaTags}</>
}
