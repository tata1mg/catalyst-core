const path = require("path")
const { spawnSync } = require("child_process")
const { arrayToObject } = require("./scriptUtils")
const { name } = require(`${process.cwd()}/package.json`)
const { BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

/**
 * @description -  Serves production build of the application.
 */

function serve() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true - Production serve keeps shell execution for existing script compatibility.
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
            shell: true,
            env: {
                ...process.env,
                src_path: process.cwd(),
                BUILD_OUTPUT_PATH: BUILD_OUTPUT_PATH,
                NODE_ENV: "production",
                IS_DEV_COMMAND: false,
                APPLICATION: name || "catalyst_app",
                ...argumentsObject,
            },
        }
    )
}

serve()
