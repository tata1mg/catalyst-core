import fs from "fs"
import path from "path"

class Extractor {
    constructor({ entrypoint }) {
        this.entrypoint = entrypoint
        this.assetPath =
            process.env.NODE_ENV === "production"
                ? `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}`
                : `http://${process.env.WEBPACK_DEV_SERVER_HOSTNAME}:${process.env.WEBPACK_DEV_SERVER_PORT}/`
        this.webStats =
            process.env.NODE_ENV === "production"
                ? path.join(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public/chunk-groups.json`)
                : path.join(__dirname, "../../../", `chunk-groups.json`)
    }

    getBootstrapScripts() {
        try {
            const statsFile = fs.readFileSync(this.webStats)
            if (statsFile) {
                const stats = JSON.parse(statsFile)
                return (
                    stats.namedChunkGroups?.[this.entrypoint]?.assets
                        ?.filter((asset) => asset?.name?.endsWith(".js"))
                        .map((asset) => `${this.assetPath}${asset?.name}`) || []
                )
            }
            return []
        } catch (error) {
            console.log("Unable to fetch bootstrap scripts", error)
        }
    }

    async getBootstrapCss() {
        try {
            let pageCss = ""
            const statsFile = fs.readFileSync(this.webStats)
            if (statsFile) {
                const stats = JSON.parse(statsFile)
                const cssFiles = stats.namedChunkGroups?.[this.entrypoint]?.assets?.filter((asset) =>
                    asset?.name?.endsWith(".css")
                )

                if (process.env.NODE_ENV === "production") {
                    cssFiles.forEach((file) => {
                        pageCss += fs.readFileSync(
                            path.join(
                                process.env.src_path,
                                `${process.env.BUILD_OUTPUT_PATH}/public/${file?.name}`
                            )
                        )
                    })
                } else {
                    const cssRequests = cssFiles.map((file) => {
                        return this.getAssetFromWebpackDevServer(file.name)
                    })
                    const resolvedCss = await Promise.all(cssRequests)
                    resolvedCss.forEach((cssContent) => {
                        pageCss += cssContent
                    })
                }
            }
            return pageCss
        } catch (error) {
            console.log("Unable to fetch bootstrap css", error)
        }
    }

    async getAssetFromWebpackDevServer(assetName = "") {
        try {
            if (process.env.NODE_ENV !== "production") {
                const filePath = `http://${process.env.WEBPACK_DEV_SERVER_HOSTNAME}:${process.env.WEBPACK_DEV_SERVER_PORT}/${assetName}`
                const response = await fetch(filePath)
                const textContent = await response.text()
                return textContent
            }
        } catch (error) {
            console.log("Unable to fetch asset from webpack dev server", error)
        }
    }
}

export default Extractor
