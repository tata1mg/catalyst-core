import fs from "fs"
import path from "path"
import { createRequire } from "module"
import { pathToFileURL } from "url"
import { arrayToObject } from "./scriptUtils.js"
import { generateCriticalCss } from "../critical-css/generate.js"

/**
 * @description - `catalyst critical-css`: generates first-fold CSS for the routes listed in
 * criticalCss.config.json, against an already running production server (`catalyst serve`).
 * Writes <BUILD_OUTPUT_PATH>/critical-css/; restart the server afterwards so it picks the manifest up.
 *
 * Optional args: BASE_URL=http://host:port
 * Needs playwright (or playwright-core plus a Chromium) installed in the app.
 */
async function run() {
    const appRoot = process.env.PWD
    const args = arrayToObject(process.argv.slice(2))
    const appConfig = JSON.parse(fs.readFileSync(path.join(appRoot, "config/config.json"), "utf8"))
    const configPath = path.join(appRoot, "criticalCss.config.json")
    if (!fs.existsSync(configPath)) {
        console.log("critical-css: no criticalCss.config.json — nothing to generate")
        return
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))

    const appRequire = createRequire(path.join(appRoot, "package.json"))
    let playwright
    for (const name of ["playwright", "playwright-core"]) {
        try {
            playwright = await import(pathToFileURL(appRequire.resolve(name)).href)
            break
        } catch {
            // try the next one
        }
    }
    if (!playwright) throw new Error("critical-css: install playwright (or playwright-core) in the app")
    const chromium = playwright.chromium || playwright.default?.chromium

    const baseUrl =
        args.BASE_URL ||
        config.baseUrl ||
        `http://${appConfig.NODE_SERVER_HOSTNAME || "localhost"}:${appConfig.NODE_SERVER_PORT}`
    const outDir = path.join(appRoot, appConfig.BUILD_OUTPUT_PATH || "build", "critical-css")

    await generateCriticalCss({
        chromium,
        baseUrl,
        routes: config.routes || [],
        outDir,
        viewports: config.viewports,
        userAgent: config.userAgent,
        maxBytes: config.maxBytes,
        launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {},
    })
}

run().catch((error) => {
    console.error(error)
    process.exit(1)
})
