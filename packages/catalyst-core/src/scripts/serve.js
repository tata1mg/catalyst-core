import path from "path"
import { spawn } from "child_process"
import { arrayToObject, loaderImportArg, resolveOutputMode } from "./scriptUtils.js"
import { runStaticPreflightOrExit, checkBuildMatchesConfig, renderRegistryError } from "./preflight.js"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { existsSync, readFileSync } from "fs"
import { createRequire } from "module"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const requireCjs = createRequire(import.meta.url)
const { diagnostic } = requireCjs("../cli/diagnostic.js")
const { superviseServer, ensurePortFree } = requireCjs("../cli/devOutput.js")
const { loadAppConfig } = requireCjs("../cli/appConfig.js")

const loaderPath = path.resolve(__dirname, "../../dist/vite/node-loader.mjs")
const preInitPath = path.resolve(__dirname, "preServerInit.js")

/**
 * @description - serves the production build
 *
 * Output is inherited, not piped through the `start` formatter. Production
 * output is read by log shippers (pm2, Docker, Datadog) one JSON line at a
 * time, so every byte the app writes must arrive unaltered and on the stream
 * it was written to. CATALYST_WRAPPED stays unset, so the server prints its
 * banner plainly with no fences to consume.
 */
async function startProd() {
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
                message: `No production build in ${path.relative(process.env.PWD, buildDir) || buildDir}/`,
                scope: "server",
                hint: "Run catalyst build first, then catalyst serve.",
            })
        )
        process.exit(1)
    }

    // After the missing-build check, so a missing build gets that message
    // rather than a "skipping the check" warning first.
    const staleBuild = checkBuildMatchesConfig(undefined, argumentsObject)
    if (staleBuild) {
        process.stderr.write(renderRegistryError(staleBuild, outputMode, { scope: "server" }))
        process.exit(1)
    }

    await ensurePortFree({
        port: argumentsObject.NODE_SERVER_PORT || appConfig.NODE_SERVER_PORT,
        host: argumentsObject.NODE_SERVER_HOSTNAME || appConfig.NODE_SERVER_HOSTNAME,
        scope: "server",
    })

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
            stdio: "inherit",
            env: {
                ...process.env,
                // When the command was run, so "Ready in" counts the whole wait.
                CATALYST_STARTED_AT: String(Math.round(performance.timeOrigin)),
                src_path: process.env.PWD,
                NODE_ENV: "production",
                APPLICATION: name || "catalyst_app",
                CATALYST_OUTPUT_MODE: outputMode,
                ...argumentsObject,
                filterKeys: JSON.stringify([
                    "src_path",
                    "NODE_ENV",
                    "APPLICATION",
                    ...Object.keys(argumentsObject),
                ]),
            },
        }
    )

    superviseServer(child, { scope: "server", label: "production server", passthrough: true })
}

startProd()
