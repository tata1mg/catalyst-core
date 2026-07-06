/**
 * @description generate assets url according to enviorment
 * @returns returns path required for loading assets according to enviorment
 */
export const imageUrl = () => {
    const {
        PUBLIC_STATIC_ASSET_URL,
        PUBLIC_STATIC_ASSET_PATH,
        IS_DEV_COMMAND,
        NODE_SERVER_HOSTNAME,
        NODE_SERVER_PORT,
    } = process.env
    let publicPath = `${PUBLIC_STATIC_ASSET_URL}${PUBLIC_STATIC_ASSET_PATH}`

    // serves assets from localhost on running devBuild and devServe command
    if (IS_DEV_COMMAND === "true") {
        publicPath = `http://${NODE_SERVER_HOSTNAME}:${NODE_SERVER_PORT}/${PUBLIC_STATIC_ASSET_PATH}`
    }

    const imagePath = JSON.stringify(`${publicPath}images/`)

    return imagePath
}

/**
 * @description generate assets font url according to enviorment
 * @returns returns path required for loading fonts according to enviorment
 */
export const fontUrl = () => {
    const {
        PUBLIC_STATIC_ASSET_URL,
        PUBLIC_STATIC_ASSET_PATH,
        IS_DEV_COMMAND,
        NODE_SERVER_HOSTNAME,
        NODE_SERVER_PORT,
    } = process.env
    let publicPath = `${PUBLIC_STATIC_ASSET_URL}${PUBLIC_STATIC_ASSET_PATH}`

    // serves assets from localhost on running devBuild and devServe command
    if (IS_DEV_COMMAND === "true") {
        publicPath = `http://${NODE_SERVER_HOSTNAME}:${NODE_SERVER_PORT}/${PUBLIC_STATIC_ASSET_PATH}`
    }

    const fontPath = JSON.stringify(`${publicPath}fonts/`)

    return fontPath
}
