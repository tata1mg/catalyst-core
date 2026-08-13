import path from "path"
import { spawn } from "child_process"
import { arrayToObject, loaderImportArg } from "./scriptUtils.js"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { readFileSync } from "fs"
import { createRequire } from "module"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const requireCjs = createRequire(import.meta.url)
const { superviseServer } = requireCjs("../cli/devOutput.js")

const loaderPath = path.resolve(__dirname, "../../dist/vite/node-loader.mjs")
const preInitPath = path.resolve(__dirname, "preServerInit.js")

/**
 * @description - starts the dev server
 *
 * stdio is piped rather than inherited so this command owns every line it
 * prints. The server child speaks in three unrelated voices -- Node process
 * warnings, Vite notices, and our own banner -- and inheriting stdio meant
 * they interleaved raw, with the banner arriving last and reading as an
 * afterthought.
 */
function start() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    // Read package.json
    const packageJson = JSON.parse(readFileSync(path.join(process.env.PWD, "package.json"), "utf-8"))
    const { name } = packageJson

    const child = spawn(
        "node",
        ["--import", preInitPath, "--import", loaderImportArg(loaderPath), "./dist/server/expressServer.js"],
        {
            cwd: dirname,
            stdio: ["inherit", "pipe", "pipe"],
            env: {
                ...process.env,
                // Piping the child's stdout makes it a non-TTY, so colour
                // libraries in the child disable themselves and the banner
                // arrives grey. Pass our own terminal's answer down, so the
                // child colours only when there is a real terminal to colour
                // for -- and a redirect to a file still comes out plain.
                ...(process.stdout.isTTY && !process.env.NO_COLOR ? { FORCE_COLOR: "1" } : {}),
                // Tells the server its output is being consumed, so it may
                // fence the banner. Unset when run directly.
                CATALYST_WRAPPED: "1",
                src_path: process.env.PWD,
                NODE_ENV: "development",
                IS_DEV_COMMAND: false,
                APPLICATION: name || "catalyst_app",
                ...argumentsObject,
                filterKeys: JSON.stringify([
                    "CATALYST_WRAPPED",
                    "src_path",
                    "NODE_ENV",
                    "IS_DEV_COMMAND",
                    "APPLICATION",
                    ...Object.keys(argumentsObject),
                ]),
            },
        }
    )

    superviseServer(child, { scope: "dev server", label: "development server" })
}

start()
