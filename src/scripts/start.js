const path = require("path")
const { spawnSync } = require("child_process")
const { arrayToObject } = require("./scriptUtils")
const { name } = require(`${process.env.PWD}/package.json`)

/**
 * @description - starts webpack dev server and node server.
 */
function start() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../")

    const command = `
    node ./scripts/checkVersion
    npx babel-node -r ./scripts/loadScriptsBeforeServerStarts.js webpack/development.client.babel --no-warnings=ExperimentalWarning --no-warnings=BABEL & npx babel-node -r ./scripts/loadScriptsBeforeServerStarts.js ./server/startServer.js --watch-path=${process.env.PWD}/server --watch-path=${process.env.PWD}/src --ignore='__IGNORE__' --no-warnings=ExperimentalWarning --no-warnings=BABEL
    `

    spawnSync(command, [], {
        cwd: dirname,
        stdio: "inherit",
        shell: true,
        env: {
            ...process.env,
            src_path: process.env.PWD,
            NODE_ENV: "development",
            IS_DEV_COMMAND: false,
            APPLICATION: name || "catalyst_app",
            ...argumentsObject,
        },
    })
}

start()
