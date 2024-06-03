const path = require("path")
const { spawnSync } = require("child_process")
const { arrayToObject } = require("./scriptUtils")
const { name } = require(`${process.env.PWD}/package.json`)
const { BUILD_OUTPUT_PATH } = require(`${process.env.PWD}/config/config.json`)

/**
 * @description -  Serves production build of the application.
 */

function devServe() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../")

    const command = `
    APPLICATION=${name || "catalyst_app"} node -r ./scripts/loadScriptsBeforeServerStarts.js ${process.env.PWD}/${BUILD_OUTPUT_PATH}/startServer.js
    `

    spawnSync(command, [], {
        cwd: dirname,
        stdio: "inherit",
        shell: true,
        env: {
            ...process.env,
            src_path: process.env.PWD,
            build_output_path: BUILD_OUTPUT_PATH,
            NODE_ENV: "production",
            IS_DEV_COMMAND: true,
            ...argumentsObject,
        },
    })
}

devServe()
