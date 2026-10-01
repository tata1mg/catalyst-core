import path from "path"
import { spawn } from "child_process"
import { arrayToObject, resolveOutputMode, getDebugEnvInfo } from "./scriptUtils.js"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { readFileSync, existsSync, rmSync } from "fs"
import { createRequire } from "module"
import { wrapForeignError, formatError } from "../errors/index.js"
import { runStaticPreflightOrExit } from "./preflight.js"

// Fail fast on a misconfigured app (missing/invalid config.json, package.json,
// or moduleAliases) with a coded, doc-linked error — must run before the raw
// config.json read below, which would otherwise crash with a bare
// ENOENT/SyntaxError on a broken config.
runStaticPreflightOrExit()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const loaderPath = path.resolve(__dirname, "../../dist/vite/node-loader.mjs")
const configPath = path.join(process.env.PWD, "config/config.json")
const configJSON = JSON.parse(readFileSync(configPath), "utf-8")

// Resolve vite's actual JS entry point rather than spawning the "vite" command name,
// which on Windows only resolves via the npm-installed .cmd shim (i.e. requires a shell).
// Invoking process.execPath + this path directly works cross-platform with no shell.
const require = createRequire(import.meta.url)
const viteBinPath = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js")

/**
 * @param {string[]} args
 * @param {import('child_process').SpawnOptions} options
 */
function runBuildStep(args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, options)
        child.on("close", (code) => {
            if (code === 0) {
                resolve()
            } else {
                reject(Object.assign(new Error(`Build step failed with exit code ${code}`), { code }))
            }
        })
        child.on("error", reject)
    })
}

/**
 * @description - builds the application for production
 */
async function build() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const outputMode = resolveOutputMode(process.argv)
    const dirname = path.resolve(__dirname, "../../")

    // Read package.json
    const packageJson = JSON.parse(readFileSync(path.join(process.env.PWD, "package.json"), "utf-8"))
    const { name } = packageJson

    const buildOutputPath = path.join(process.env.PWD, configJSON.BUILD_OUTPUT_PATH || "build")
    if (existsSync(buildOutputPath)) {
        console.log("🧹 Clearing previous build output...")
        rmSync(buildOutputPath, { recursive: true, force: true })
    }

    console.log("🏗️  Building application for production...")

    const baseEnv = {
        ...process.env,
        src_path: process.env.PWD,
        NODE_ENV: "production",
        VITE_BUILD_MODE: "true",
        APPLICATION: name || "catalyst_app",
        NODE_OPTIONS: `--loader ${loaderPath}`,
        CATALYST_OUTPUT_MODE: outputMode,
        ...argumentsObject,
        filterKeys: JSON.stringify([
            "src_path",
            "NODE_ENV",
            "VITE_BUILD_MODE",
            "APPLICATION",
            ...Object.keys(argumentsObject),
        ]),
    }

    const serverBuildArgs = [viteBinPath, "build", "--config", "./dist/vite/vite.config.server.js", "--ssr"]
    const clientBuildArgs = [viteBinPath, "build", "--config", "./dist/vite/vite.config.client.js"]
    const spawnBase = {
        cwd: dirname,
        stdio: "inherit",
    }

    console.log("🔧📦 Building server and client bundles in parallel...")

    try {
        await Promise.all([
            runBuildStep(serverBuildArgs, {
                ...spawnBase,
                env: { ...baseEnv, CATALYST_VITE_CACHE_ID: "ssr" },
            }),
            runBuildStep(clientBuildArgs, {
                ...spawnBase,
                env: { ...baseEnv, CATALYST_VITE_CACHE_ID: "client" },
            }),
        ])
    } catch (err) {
        console.error("❌ Build failed!")
        const debugEnv = outputMode === "debug" ? getDebugEnvInfo() : undefined
        console.error(formatError(wrapForeignError("BUNDLE", err), outputMode, debugEnv))
        process.exit(1)
    }

    console.log("✅ Server and client builds completed!")

    await runBuildStep(["./dist/scripts/generateOfflineManifest.js"], {
        ...spawnBase,
        env: baseEnv,
    })

    console.log("🎉 Build completed successfully!")
    console.log("📁 Built files are located in the 'build' directory")
    console.log("🚀 Run 'npm run serve' to start the production server")
}

build().catch((err) => {
    console.error(err)
    process.exit(1)
})
