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
    const { IS_DEV_COMMAND, WEBPACK_DEV_SERVER_HOSTNAME, WEBPACK_DEV_SERVER_PORT } = process.env

    let publicAssetPath = `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}`

    if (JSON.parse(IS_DEV_COMMAND)) {
        publicAssetPath = `http://${WEBPACK_DEV_SERVER_HOSTNAME}:${WEBPACK_DEV_SERVER_PORT}/assets/`
    }

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
