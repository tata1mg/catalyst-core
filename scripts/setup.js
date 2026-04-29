const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const repoRoot = path.resolve(__dirname, "..")
const docsDir = path.join(repoRoot, "docs")
const docsConfigPath = path.join(docsDir, "config.json")
const docsConfigTemplatePath = path.join(docsDir, "config_template.json")

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        stdio: "inherit",
        shell: process.platform === "win32",
        ...options,
    })

    if (result.status !== 0) {
        process.exit(result.status || 1)
    }
}

run("npm", ["ci", "--ignore-scripts"])
run("npm", ["--prefix", "docs", "ci", "--ignore-scripts"])

if (!fs.existsSync(docsConfigPath)) {
    fs.copyFileSync(docsConfigTemplatePath, docsConfigPath)
    console.log("Created docs/config.json from docs/config_template.json")
} else {
    console.log("Keeping existing docs/config.json")
}

run("node", ["scripts/copyConfig.js"], { cwd: docsDir })
