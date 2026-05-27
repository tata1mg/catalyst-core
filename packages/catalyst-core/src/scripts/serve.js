const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { red, yellow, cyan } = require("picocolors")
const { arrayToObject } = require("./scriptUtils")
const { name } = require(`${process.cwd()}/package.json`)
const appConfig = require(`${process.cwd()}/config/config.json`)
const { BUILD_OUTPUT_PATH, PUBLIC_STATIC_ASSET_URL, PUBLIC_STATIC_ASSET_PATH } = appConfig

const BUILD_META_FILENAME = "build-meta.json"
const TRACKED_KEYS = ["PUBLIC_STATIC_ASSET_URL", "PUBLIC_STATIC_ASSET_PATH"]

/**
 * @description - Aborts when the current config.json disagrees with the values that
 * webpack baked into the build. Without this check `serve` happily logs the new host
 * while the HTML it serves still references chunks at the old host, which is hard to
 * diagnose (e.g. when developing across a changing local IP).
 */
function assertBuildMatchesConfig() {
    const metaPath = path.join(process.cwd(), BUILD_OUTPUT_PATH, BUILD_META_FILENAME)

    if (!fs.existsSync(metaPath)) {
        console.warn(
            yellow(
                `\n[serve] ${BUILD_META_FILENAME} not found in ${BUILD_OUTPUT_PATH}/. ` +
                    `Skipping build/config consistency check — rebuild to enable it.\n`
            )
        )
        return
    }

    let meta
    try {
        meta = JSON.parse(fs.readFileSync(metaPath, "utf8"))
    } catch (err) {
        console.warn(
            yellow(`\n[serve] Failed to parse ${BUILD_META_FILENAME}: ${err.message}. Skipping check.\n`)
        )
        return
    }

    const current = { PUBLIC_STATIC_ASSET_URL, PUBLIC_STATIC_ASSET_PATH }
    const mismatches = TRACKED_KEYS.filter((key) => meta[key] !== current[key])

    if (mismatches.length === 0) return

    console.error(red("\n[serve] Build is stale relative to config/config.json.\n"))
    console.error(
        "The following values were baked into the build but differ from the current config:\n"
    )
    mismatches.forEach((key) => {
        console.error(`  ${cyan(key)}`)
        console.error(`    built with: ${meta[key]}`)
        console.error(`    config now: ${current[key]}`)
    })
    console.error(
        `\nThese values are embedded into client assets at build time, so serving this build` +
            `\nwould reference assets at the old host. Run ${cyan("npm run build")} to rebuild.\n`
    )
    process.exit(1)
}

/**
 * @description -  Serves production build of the application.
 */

function serve() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    assertBuildMatchesConfig()

    const command = `cross-env APPLICATION=${name || "catalyst_app"} node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ${process.cwd()}/${BUILD_OUTPUT_PATH}/startServer.js`

    spawnSync(command, [], {
        cwd: dirname,
        stdio: "inherit",
        shell: true,
        env: {
            ...process.env,
            src_path: process.cwd(),
            BUILD_OUTPUT_PATH: BUILD_OUTPUT_PATH,
            NODE_ENV: "production",
            IS_DEV_COMMAND: false,
            ...argumentsObject,
        },
    })
}

serve()
