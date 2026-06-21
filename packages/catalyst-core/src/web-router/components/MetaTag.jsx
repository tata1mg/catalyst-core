import React, { useContext, useState, useEffect } from "react"
import { HelmetProvider, Helmet } from "react-helmet-async"
import { OneMgRouterContext } from "../context.jsx"
import { useRouterData } from "./RouterDataProvider.jsx"
import { deleteHeadTagsByDataAttribute, getMetaData } from "../utils/metaDataUtils.jsx"
import { useLocation } from "react-router-dom"

/**
 * @description renders meta tags component assigned to setMetaData
 */
export const MetaTag = () => {
    const { matchedRoutes } = useContext(OneMgRouterContext)
    const routeData = useRouterData()
    const location = useLocation()
    const [metaTags, setMetaTags] = useState([<meta key={0}></meta>])

    useEffect(() => {
        const mergedMetaTags = getMetaData(matchedRoutes, routeData)
        if (Array.isArray(mergedMetaTags) && mergedMetaTags.length > 0) {
            setMetaTags(mergedMetaTags)
        }
        return () => deleteHeadTagsByDataAttribute("catalyst")
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location])

    if (Array.isArray(metaTags) && metaTags.length >= 0) {
        return (
            <HelmetProvider>
                <Helmet>{metaTags}</Helmet>
            </HelmetProvider>
        )
    }
    return <></>
}
