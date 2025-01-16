const path = require("path")
const { spawnSync } = require("child_process")
const { green, cyan, yellow } = require("picocolors")
const { name } = require(`${process.cwd()}/package.json`)
const { BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)
const { arrayToObject, printBundleInformation } = require("./scriptUtils.js")

/**
 * @description - creates a production build of the application.
 */
function build() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    const checkVersion = "node ./dist/scripts/checkVersion"
    const beforeServerScript = `rm -rf ${process.cwd()}/${BUILD_OUTPUT_PATH} & node ./dist/scripts/loadScriptsBeforeServerStarts.js`
    const buildClient = `APPLICATION=${name || "catalyst_app"} webpack --config ./dist/webpack/production.client.babel.js --progress`
    const buildSSRServer = `APPLICATION=${name || "catalyst_app"} SSR=true webpack --config ./dist/webpack/production.ssr.babel.js`
    const buildInternalServer = `APPLICATION=${name || "catalyst_app"} npx babel ./dist/server --out-dir ${process.cwd()}/${BUILD_OUTPUT_PATH} --ignore '**/*.test.js,./dist/server/renderer/handler.js' --quiet`
    const buildServer = `APPLICATION=${name || "catalyst_app"} npx babel ${process.cwd()}/server --out-dir ${process.cwd()}/${BUILD_OUTPUT_PATH} --quiet`

    const command = `start ${checkVersion} && start ${beforeServerScript} && start ${buildClient} && start ${buildSSRServer} && start ${buildInternalServer} && start ${startServer}`

    console.log("Creating an optimized production build...")

    const result = spawnSync(command, [], {
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

    if (result.error) {
        console.error("Error occurred:", result.error)
    } else {
        console.log(green("Compiled successfully."))
        console.log("\nFile sizes after gzip:\n")
        printBundleInformation()
        console.log(`\nThe ${cyan(BUILD_OUTPUT_PATH)} folder is ready to be deployed.`)
        console.log("You may serve it with a serve command:")
        console.log(cyan("\n npm run serve"))
        console.log("\nFind out more about deployment here:")
        console.log(yellow("\n https://catalyst.1mg.com/public_docs/content/deployment\n"))
    }
}

build()
