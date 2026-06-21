import path from "path"
import { spawn } from "child_process"
import { arrayToObject } from "./scriptUtils.js"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { readFileSync, existsSync, rmSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const loaderPath = path.resolve(__dirname, "../../dist/vite/node-loader.mjs")
const configPath = path.join(process.env.PWD, "config/config.json")
const configJSON = JSON.parse(readFileSync(configPath), "utf-8")

/**
 * @param {string} command
 * @param {import('child_process').SpawnOptions} options
 */
function runBuildStep(command, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, [], {
            ...options,
            shell: true,
        })
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
        ...argumentsObject,
        filterKeys: JSON.stringify([
            "src_path",
            "NODE_ENV",
            "VITE_BUILD_MODE",
            "APPLICATION",
            ...Object.keys(argumentsObject),
        ]),
    }

    const serverBuildCommand = `vite build --config ./dist/vite/vite.config.server.js --ssr`
    const clientBuildCommand = `vite build --config ./dist/vite/vite.config.client.js`
    const spawnBase = {
        cwd: dirname,
        stdio: "inherit",
    }

    console.log("🔧📦 Building server and client bundles in parallel...")

    try {
        await Promise.all([
            runBuildStep(serverBuildCommand, {
                ...spawnBase,
                env: { ...baseEnv, CATALYST_VITE_CACHE_ID: "ssr" },
            }),
            runBuildStep(clientBuildCommand, {
                ...spawnBase,
                env: { ...baseEnv, CATALYST_VITE_CACHE_ID: "client" },
            }),
        ])
    } catch {
        console.error("❌ Build failed!")
        process.exit(1)
    }

    console.log("✅ Server and client builds completed!")

    console.log("🎉 Build completed successfully!")
    console.log("📁 Built files are located in the 'build' directory")
    console.log("🚀 Run 'npm run serve' to start the production server")
}

build().catch((err) => {
    console.error(err)
    process.exit(1)
})
