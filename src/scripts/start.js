const path = require("path")
const { spawnSync } = require("child_process")
const { arrayToObject } = require("./scriptUtils")
const { name } = require(`${process.cwd()}/package.json`)
const { BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

/**
 * @description - starts webpack dev server and node server.
 */
function start() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    const versionCheck = "node ./dist/scripts/checkVersion"
    const webpackDevServer =
        "npx babel-node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ./dist/webpack/development.client.babel --no-warnings=ExperimentalWarning --no-warnings=BABEL"
    const server = `npx babel-node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ./dist/server/startServer.js --watch-path=${process.cwd()}/server --watch-path=${process.cwd()}/src --ignore='__IGNORE__' --no-warnings=ExperimentalWarning --no-warnings=BABEL`

    const command = `
        start ${versionCheck} && 
        start ${webpackDevServer} &&
        start ${server}`

    spawnSync(command, [], {
        cwd: dirname,
        stdio: "inherit",
        shell: true,
        env: {
            ...process.env,
            src_path: process.cwd(),
            NODE_ENV: "development",
            IS_DEV_COMMAND: false,
            APPLICATION: name || "catalyst_app",
            BUILD_OUTPUT_PATH: BUILD_OUTPUT_PATH,
            ...argumentsObject,
        },
    })
}

start()
