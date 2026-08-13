import path from "path"
import { spawn } from "child_process"
import { arrayToObject, loaderImportArg, resolveOutputMode } from "./scriptUtils.js"
import { runStaticPreflightOrExit, checkBuildMatchesConfig } from "./preflight.js"
import { formatError } from "../errors/index.js"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { existsSync, readFileSync } from "fs"
import { createRequire } from "module"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const requireCjs = createRequire(import.meta.url)
const { diagnostic } = requireCjs("../cli/diagnostic.js")
const { superviseServer } = requireCjs("../cli/devOutput.js")
const { loadAppConfig } = requireCjs("../cli/appConfig.js")

const loaderPath = path.resolve(__dirname, "../../dist/vite/node-loader.mjs")
const preInitPath = path.resolve(__dirname, "preServerInit.js")

/**
 * @description - serves the production build
 *
 * Output is piped, not inherited, for the same reason as `start`: the server
 * fences its banner expecting a wrapper to consume those markers, and Node's
 * multi-line process warnings need collapsing. With inherited stdio the fences
 * reached the screen and the warnings arrived raw.
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

    // Serving a build that was never made produces a stack trace from deep
    // inside the server. Say the useful thing instead.
    // From config.json, not the env: config values are promoted to env only
    // inside the child, so reading env here always saw the default.
    const appConfig = loadAppConfig(process.env.PWD || process.cwd())
    const buildDir = path.join(
        process.env.PWD,
        appConfig.BUILD_OUTPUT_PATH || process.env.BUILD_OUTPUT_PATH || "build"
    )
    if (!existsSync(buildDir)) {
        process.stderr.write(
            diagnostic({
                message: "The production build was not found",
                scope: "server",
                file: buildDir,
                hint: "Run catalyst build first, then catalyst serve.",
            })
        )
        process.exit(1)
    }

    // After the missing-build check, so a missing build gets that message
    // rather than a "skipping the check" warning first.
    const staleBuild = checkBuildMatchesConfig(undefined, argumentsObject)
    if (staleBuild) {
        console.error(formatError(staleBuild, outputMode))
        process.exit(1)
    }

    const inspectArgs = commandLineArguments.includes("--inspect") ? ["--inspect"] : []
    const child = spawn(
        "node",
        [
            ...inspectArgs,
            "--import",
            preInitPath,
            "--import",
            loaderImportArg(loaderPath),
            "./dist/server/expressServer.js",
        ],
        {
            cwd: dirname,
            stdio: ["inherit", "pipe", "pipe"],
            env: {
                ...process.env,
                // Piping makes the child's stdout a non-TTY, which would strip
                // its colour. Forward our own terminal's answer.
                ...(process.stdout.isTTY && !process.env.NO_COLOR ? { FORCE_COLOR: "1" } : {}),
                // Tells the server its output is being consumed, so it may
                // fence the banner. Unset when run directly.
                CATALYST_WRAPPED: "1",
                src_path: process.env.PWD,
                NODE_ENV: "production",
                APPLICATION: name || "catalyst_app",
                CATALYST_OUTPUT_MODE: outputMode,
                ...argumentsObject,
                filterKeys: JSON.stringify([
                    "CATALYST_WRAPPED",
                    "src_path",
                    "NODE_ENV",
                    "APPLICATION",
                    ...Object.keys(argumentsObject),
                ]),
            },
        }
    )

    superviseServer(child, { scope: "server", label: "production server" })
}

startProd()
