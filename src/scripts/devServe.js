const path = require("path")
const { spawnSync } = require("child_process")
const { arrayToObject } = require("./scriptUtils")
const { name } = require(`${process.cwd()}/package.json`)
const { BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

/**
 * @description -  Serves production build of the application.
 */

function devServe() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

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
            IS_DEV_COMMAND: true,
            ...argumentsObject,
        },
    })
}

devServe()
