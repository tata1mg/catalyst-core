import path from "path"
import { spawnSync } from "child_process"
import { arrayToObject, resolveOutputMode } from "./scriptUtils.js"
import { runStaticPreflightOrExit } from "./preflight.js"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { readFileSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const loaderPath = path.resolve(__dirname, "../../dist/vite/node-loader.mjs")
const preInitPath = path.resolve(__dirname, "preServerInit.js")

/**
 * @description - starts the application in production mode
 */
function startProd() {
    // Fail fast on a misconfigured app before spawning the production server.
    runStaticPreflightOrExit()

    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const outputMode = resolveOutputMode(process.argv)
    const dirname = path.resolve(__dirname, "../../")

    // Read package.json
    const packageJson = JSON.parse(readFileSync(path.join(process.env.PWD, "package.json"), "utf-8"))
    const { name } = packageJson

    console.log("🚀 Starting production server...")

    const inspectArgs = commandLineArguments.includes("--inspect") ? ["--inspect"] : []
    spawnSync(
        "node",
        [...inspectArgs, "--import", preInitPath, "--loader", loaderPath, "./dist/server/expressServer.js"],
        {
            cwd: dirname,
            stdio: "inherit",
            env: {
                ...process.env,
                src_path: process.env.PWD,
                NODE_ENV: "production",
                IS_DEV_COMMAND: false,
                APPLICATION: name || "catalyst_app",
                CATALYST_OUTPUT_MODE: outputMode,
                ...argumentsObject,
                filterKeys: JSON.stringify([
                    "src_path",
                    "NODE_ENV",
                    "IS_DEV_COMMAND",
                    "APPLICATION",
                    ...Object.keys(argumentsObject),
                ]),
            },
        }
    )
}

startProd()
