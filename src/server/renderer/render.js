/**
 * Returns data used by the Head component for page rendering.
 */
export const renderStart = ({
    inlineCss,
    jsScripts,
    criticalPreloadLinks,
    deferredPreloadLinks,
    metaTags,
    isBot,
    fetcherData,
}) => {
    const { IS_DEV_COMMAND, WEBPACK_DEV_SERVER_HOSTNAME, WEBPACK_DEV_SERVER_PORT } = process.env

    let publicAssetPath = `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}`

    if (JSON.parse(IS_DEV_COMMAND)) {
        publicAssetPath = `http://${WEBPACK_DEV_SERVER_HOSTNAME}:${WEBPACK_DEV_SERVER_PORT}/assets/`
    }

    return {
        inlineCss,
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
export const renderEnd = (initialState = {}, res, jsx, errorCode, fetcherData) => {
    return {
        initialState,
        firstFoldCss: "",
        firstFoldJS: "",
        jsx,
        errorCode,
        fetcherData,
    }
}
