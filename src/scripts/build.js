import path from "path"
import { spawnSync } from "child_process"
import { arrayToObject } from "./scriptUtils.js"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { readFileSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * @description - builds the application for production
 */
function build() {
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    // Read package.json
    const packageJson = JSON.parse(readFileSync(path.join(process.env.PWD, "package.json"), "utf-8"))
    const { name } = packageJson

    console.log("🏗️  Building application for production...")

    const baseEnv = {
        ...process.env,
        src_path: process.env.PWD,
        NODE_ENV: "production",
        VITE_BUILD_MODE: "true",
        APPLICATION: name || "catalyst_app",
        ...argumentsObject,
        filterKeys: JSON.stringify([
            "src_path",
            "NODE_ENV",
            "VITE_BUILD_MODE",
            "APPLICATION",
            ...Object.keys(argumentsObject),
        ]),
    }

    // Build server bundle
    console.log("🔧 Building server bundle...")
    const serverBuildCommand = `vite build --config ./dist/server/vite.config.server.js --ssr`

    const serverBuildResult = spawnSync(serverBuildCommand, [], {
        cwd: dirname,
        stdio: "inherit",
        shell: true,
        env: baseEnv,
    })

    if (serverBuildResult.status !== 0) {
        console.log(serverBuildResult)
        console.error("❌ Server build failed!")
        process.exit(1)
    }

    console.log("✅ Server build completed!")

    // Build client bundle
    console.log("📦 Building client bundle...")
    const clientBuildCommand = `vite build --config ./dist/server/vite.config.client.js`

    const clientBuildResult = spawnSync(clientBuildCommand, [], {
        cwd: dirname,
        stdio: "inherit",
        shell: true,
        env: baseEnv,
    })

    if (clientBuildResult.status !== 0) {
        console.error("❌ Client build failed!")
        process.exit(1)
    }

    console.log("✅ Client build completed!")

    console.log("🎉 Build completed successfully!")
    console.log("📁 Built files are located in the 'build' directory")
    console.log("🚀 Run 'npm run serve' to start the production server")
}

build()
