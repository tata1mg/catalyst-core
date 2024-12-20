const path = require("path")
const { spawnSync } = require("child_process")
const { green, cyan, yellow } = require("picocolors")
const { name } = require(`${process.env.PWD}/package.json`)
const { BUILD_OUTPUT_PATH } = require(`${process.env.PWD}/config/config.json`)
const { arrayToObject, printBundleInformation } = require("./scriptUtils.js")

/**
 * @description - creates a production build of the application.
 */
function devBuild() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    const command = `
    node ./dist/scripts/checkVersion
    rm -rf ${process.env.PWD}/${BUILD_OUTPUT_PATH} & node ./dist/scripts/loadScriptsBeforeServerStarts.js
    APPLICATION=${name || "catalyst_app"} webpack --config ./dist/webpack/production.client.babel.js --progress
    APPLICATION=${name || "catalyst_app"} SSR=true webpack --config ./dist/webpack/production.ssr.babel.js
    APPLICATION=${name || "catalyst_app"} npx babel ./dist/server --out-dir ${process.env.PWD}/${BUILD_OUTPUT_PATH} --ignore '**/*.test.js,./dist/server/renderer/handler.js' --quiet 
    APPLICATION=${name || "catalyst_app"} npx babel ${process.env.PWD}/server --out-dir ${process.env.PWD}/${BUILD_OUTPUT_PATH} --quiet
    `

    console.log("Creating an optimized local build...")

    const result = spawnSync(command, [], {
        cwd: dirname,
        stdio: "inherit",
        shell: true,
        env: {
            ...process.env,
            src_path: process.env.PWD,
            BUILD_OUTPUT_PATH: BUILD_OUTPUT_PATH,
            NODE_ENV: "production",
            IS_DEV_COMMAND: true,
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
        console.log(cyan("\n npm run devServe"))
        console.log("\nFind out more about deployment here:")
        console.log(yellow("\n https://catalyst.1mg.com/public_docs/content/deployment\n"))
    }
}

devBuild()
