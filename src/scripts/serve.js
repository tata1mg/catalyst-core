import path from "path"
import { spawnSync } from "child_process"
import { arrayToObject } from "./scriptUtils.js"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { readFileSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const loaderPath = path.resolve(__dirname, "../../dist/vite/node-loader.mjs")

/**
 * @description - starts the application in production mode
 */
function startProd() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    // Read package.json
    const packageJson = JSON.parse(readFileSync(path.join(process.env.PWD, "package.json"), "utf-8"))
    const { name } = packageJson

    console.log("🚀 Starting production server...")

    const command = `node --loader ${loaderPath} ./dist/server/expressServer.js`
    spawnSync(command, [], {
        cwd: dirname,
        stdio: "inherit",
        shell: true,
        env: {
            ...process.env,
            src_path: process.env.PWD,
            NODE_ENV: "production",
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

startProd()
