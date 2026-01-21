const path = require("path")
const { spawnSync, spawn } = require("child_process")
const { arrayToObject } = require("./scriptUtils")
const { name } = require(`${process.cwd()}/package.json`)
const { BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

/**
 * @description - starts webpack dev server and node server.
 */
function start() {
    const isWindows = process.platform === "win32"
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    // Run three separate processes for better memory isolation:
    // 1. Client DevServer (development.client.babel)
    // 2. SSR Watcher (ssr.watcher) 
    // 3. Node Server (startServer)
    const command = `
    node ./dist/scripts/checkVersion
    npx babel-node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ./dist/webpack/development.client.babel --no-warnings=ExperimentalWarning --no-warnings=BABEL & npx babel-node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ./dist/server/startServer.js --extensions .js,.ts,.jsx,.tsx --ignore='__IGNORE__' --no-warnings=ExperimentalWarning --no-warnings=BABEL
    `

    if (isWindows) {
        // Client DevServer
        spawn(
            `node ./dist/scripts/checkVersion && start /b npx babel-node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ./dist/webpack/development.client.babel --no-warnings=ExperimentalWarning --no-warnings=BABEL`,
            [],
            {
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
            }
        )

        // Node Server
        spawn(
            `node ./dist/scripts/checkVersion && npx babel-node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ./dist/server/startServer.js --watch-path=${process.cwd()}/server --watch-path=${process.cwd()}/src --ignore='__IGNORE__' --no-warnings=ExperimentalWarning --no-warnings=BABEL`,
            [],
            {
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
            }
        )
    } else {
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
}

start()
