const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const repoRoot = path.resolve(__dirname, "..")
const docsDir = path.join(repoRoot, "docs")
const docsConfigPath = path.join(docsDir, "config", "config.json")
const docsConfigTemplatePath = path.join(docsDir, "config", "config_template.json")

// npm is a .cmd on Windows, which Node refuses to spawn directly (EINVAL). Under
// `npm run` npm has told us where its script is; run directly, it takes a shell.
function npmInvocation(args) {
    if (process.platform !== "win32") return { file: "npm", args, shell: false }
    if (process.env.npm_execpath) {
        return { file: process.execPath, args: [process.env.npm_execpath, ...args], shell: false }
    }
    const quoted = args.map((arg) => `"${arg}"`)
    return { file: ["npm", ...quoted].join(" "), args: [], shell: true }
}

function run(command, args, options = {}) {
    let result
    if (command === "npm") {
        const npm = npmInvocation(args)
        // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true - fixed setup commands; see npmInvocation.
        result = spawnSync(npm.file, npm.args, {
            cwd: repoRoot,
            stdio: "inherit",
            shell: npm.shell,
            ...options,
        })
    } else if (command === "node") {
        result = spawnSync(process.execPath, args, {
            cwd: repoRoot,
            stdio: "inherit",
            ...options,
        })
    } else {
        throw new Error(`Unsupported setup command: ${command}`)
    }

    if (result.status !== 0) {
        process.exit(result.status || 1)
    }
}

run("npm", ["ci", "--ignore-scripts"])
run("npm", ["--prefix", "docs", "ci", "--ignore-scripts"])

if (!fs.existsSync(docsConfigPath)) {
    fs.copyFileSync(docsConfigTemplatePath, docsConfigPath)
    console.log("Created docs/config/config.json from docs/config/config_template.json")
} else {
    console.log("Keeping existing docs/config/config.json")
}
