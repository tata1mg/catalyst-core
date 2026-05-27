const fs = require("fs")
const path = require("path")
const { green, cyan, yellow } = require("picocolors")
const { name } = require(`${process.cwd()}/package.json`)
const appConfig = require(`${process.cwd()}/config/config.json`)
const { BUILD_OUTPUT_PATH, PUBLIC_STATIC_ASSET_URL, PUBLIC_STATIC_ASSET_PATH } = appConfig
const { arrayToObject, printBundleInformation, runBuildCommands } = require("./scriptUtils.js")

const BUILD_META_FILENAME = "build-meta.json"

/**
 * @description - Persists the config values that webpack bakes into the bundle so
 * that `serve` can detect when the build is stale relative to the current config.
 * Only keys whose values get embedded into client assets at build time are tracked here.
 */
function writeBuildMeta() {
    const meta = {
        PUBLIC_STATIC_ASSET_URL,
        PUBLIC_STATIC_ASSET_PATH,
        builtAt: new Date().toISOString(),
    }
    const metaPath = path.join(process.cwd(), BUILD_OUTPUT_PATH, BUILD_META_FILENAME)
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
}

/**
 * @description - creates a production build of the application.
 */
function build() {
    const isWindows = process.platform === "win32"
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    const commands = [
        "node ./dist/scripts/checkVersion",
        `${isWindows ? "rd -r -fo" : "rm -rf"} ${process.cwd()}/${BUILD_OUTPUT_PATH} & node ./dist/scripts/loadScriptsBeforeServerStarts.js`,
        `cross-env APPLICATION=${name || "catalyst_app"} webpack --config ./dist/webpack/production.client.babel.js --progress`,
        `cross-env APPLICATION=${name || "catalyst_app"} SSR=true webpack --config ./dist/webpack/production.ssr.babel.js`,
        `cross-env APPLICATION=${name || "catalyst_app"} npx babel ./dist/server --out-dir ${process.cwd()}/${BUILD_OUTPUT_PATH} --extensions .js,.ts,.jsx,.tsx --ignore '**/*.test.js,./dist/server/renderer/handler.js' --quiet`,
        `cross-env APPLICATION=${name || "catalyst_app"} npx babel ${process.cwd()}/server --out-dir ${process.cwd()}/${BUILD_OUTPUT_PATH} --extensions .js,.ts,.jsx,.tsx --quiet`,
    ]

    console.log("Creating an optimized production build...")

    runBuildCommands({
        commands,
        cwd: dirname,
        env: {
            ...process.env,
            src_path: process.cwd(),
            BUILD_OUTPUT_PATH: BUILD_OUTPUT_PATH,
            NODE_ENV: "production",
            IS_DEV_COMMAND: false,
            ...argumentsObject,
        },
    })

    writeBuildMeta()

    console.log(green("Compiled successfully."))
    console.log("\nFile sizes after gzip:\n")
    printBundleInformation()
    console.log(`\nThe ${cyan(BUILD_OUTPUT_PATH)} folder is ready to be deployed.`)
    console.log("You may serve it with a serve command:")
    console.log(cyan("\n npm run serve"))
    console.log("\nFind out more about deployment here:")
    console.log(
        yellow("\n https://catalyst.1mg.com/public_docs/content/Deployment%20and%20Production/deployment\n")
    )
}

build()
