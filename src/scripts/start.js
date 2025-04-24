import path from "path"
import { spawnSync } from "child_process"
import { arrayToObject } from "./scriptUtils.js"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { readFileSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * @description - starts webpack dev server and node server.
 */
function start() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    // Read package.json
    const packageJson = JSON.parse(readFileSync(path.join(process.env.PWD, "package.json"), "utf-8"))
    const { name } = packageJson

    const command = `node ./dist/server/expressServer.js`
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
            filterKeys: JSON.stringify([
                "src_path",
                "NODE_ENV",
                "IS_DEV_COMMAND",
                "APPLICATION",
                ...Object.keys(argumentsObject),
            ]),
        },
    })
}

start()
