const path = require("path")
const { spawnSync } = require("child_process")
const { arrayToObject } = require("./scriptUtils")
const { name } = require(`${process.env.PWD}/package.json`)
const { BUILD_OUTPUT_PATH } = require(`${process.env.PWD}/config/config.json`)

/**
 * @description - starts webpack dev server and node server.
 */
function start() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    const command = `
    node ./dist/scripts/checkVersion
    npx babel-node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ./dist/webpack/development.client.babel --no-warnings=ExperimentalWarning --no-warnings=BABEL & npx babel-node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ./dist/server/startServer.js --extensions .js,.ts,.jsx,.tsx --watch-path=${process.env.PWD}/server --watch-path=./.catalyst-dev/server/renderer --ignore='__IGNORE__' --no-warnings=ExperimentalWarning --no-warnings=BABEL
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
            BUILD_OUTPUT_PATH: BUILD_OUTPUT_PATH,
            ...argumentsObject,
        },
    })
}

start()
