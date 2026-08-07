import express from "express"
import path from "path"
import expressStaticGzip from "express-static-gzip"

// Server middlewares are added here.

export function addMiddlewares(app) {
    // The docs site historically served under the /public_docs mount
    // (e.g. catalyst.1mg.com/public_docs/content/...). The Hub serves the same
    // permalinks at the root, so old links must keep working.
    app.use((req, res, next) => {
        if (req.path === "/public_docs" || req.path.startsWith("/public_docs/")) {
            const target = req.originalUrl.replace(/^\/public_docs\/?/, "/")
            return res.redirect(301, target)
        }
        next()
    })

    // Legacy /docs entry point → first docs page.
    app.get(["/docs", "/docs/"], (req, res) => {
        res.redirect(301, "/content/Introduction/why-catalyst")
    })

    // SEO files (generated into public/ by scripts/generate-docs-manifest.mjs).
    app.get("/sitemap.xml", (req, res) => {
        res.type("application/xml")
        res.sendFile(path.join(__dirname, "../public/sitemap.xml"))
    })
    app.get("/robots.txt", (req, res) => {
        res.type("text/plain")
        res.sendFile(path.join(__dirname, "../public/robots.txt"))
    })

    if (process.env.NODE_ENV === "production") {
        app.use(
            `${process.env.PUBLIC_STATIC_ASSET_PATH}/client`,
            expressStaticGzip(path.join(__dirname, `../${process.env.BUILD_OUTPUT_PATH}/client`), {
                enableBrotli: true,
                orderPreference: ["br", "gz"],
                serveStatic: { maxAge: "1y", etag: true },
            })
        )
    }

    // Docs image assets (generated into public/ by scripts/generate-docs-manifest.mjs).
    app.use("/img", express.static(path.join(__dirname, "../public/img"), { maxAge: "1d" }))
    app.use("/docs-assets", express.static(path.join(__dirname, "../public/docs-assets"), { maxAge: "1d" }))
    app.use("/favicon.ico", express.static(path.join(__dirname, "../public/favicon.ico")))
}
