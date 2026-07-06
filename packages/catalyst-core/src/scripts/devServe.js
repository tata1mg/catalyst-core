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

    spawnSync(
        "node",
        [
            "-r",
            "./dist/scripts/loadScriptsBeforeServerStarts.js",
            path.join(process.cwd(), BUILD_OUTPUT_PATH, "startServer.js"),
        ],
        {
            cwd: dirname,
            stdio: "inherit",
            env: {
                ...process.env,
                src_path: process.cwd(),
                BUILD_OUTPUT_PATH: BUILD_OUTPUT_PATH,
                NODE_ENV: "production",
                IS_DEV_COMMAND: true,
                APPLICATION: name || "catalyst_app",
                ...argumentsObject,
            },
        }
    )
}

devServe()
