import type { ReactElement } from "react"

/**
 * Returns data used by the Head component for page rendering.
 */
export const renderStart = ({
    inlineCss,
    deferredRouteInlineCss,
    jsScripts,
    criticalPreloadLinks,
    deferredPreloadLinks,
    metaTags,
    isBot,
    fetcherData,
}: {
    inlineCss: string
    deferredRouteInlineCss: string
    jsScripts: ReactElement[]
    criticalPreloadLinks: ReactElement[]
    deferredPreloadLinks: ReactElement[]
    metaTags: any[]
    isBot: boolean
    fetcherData: Record<string, any>
}) => {
    const publicAssetPath = `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}`

    return {
        inlineCss,
        deferredRouteInlineCss,
        jsScripts,
        criticalPreloadLinks,
        deferredPreloadLinks,
        metaTags,
        isBot,
        publicAssetPath,
        fetcherData,
    }
}

/**
 * Returns data used by the Body component for page rendering.
 */
export const renderEnd = (
    initialState: Record<string, unknown> = {},
    _res: unknown,
    jsx: ReactElement,
    errorCode: number | null | undefined,
    fetcherData: Record<string, any>
) => {
    return {
        initialState,
        firstFoldCss: "",
        firstFoldJS: "",
        jsx,
        errorCode,
        fetcherData,
    }
}
