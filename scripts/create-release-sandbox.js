const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const repoRoot = path.resolve(__dirname, "..")
const defaultSandboxDir = path.join(repoRoot, ".sandbox")
const npmCacheDir = path.join(defaultSandboxDir, ".npm-cache")
const corePackageDir = path.join(repoRoot, "packages", "catalyst-core")
const ccaPackageDir = path.join(repoRoot, "packages", "create-catalyst-app")
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"

function usage() {
    console.log(`Usage:
  npm run sandbox:create -- [options] [-- CCA options]

Options:
  --name <name>          App folder name. Default: release-test
  --target-dir <path>    Parent directory. Default: .sandbox
  --yes, -y              Use CCA default prompts. Existing CCA behavior creates my-app first.
  --force                Remove existing sandbox app before creating it.
  --skip-build           Scaffold and install only.
  --help, -h             Show help.

Examples:
  npm run sandbox:create -- --name release-test
  npm run sandbox:create -- --name release-test --yes --force
  npm run sandbox:create -- --name release-test -- --state-management redux
`)
}

function parseArgs(argv) {
    const options = {
        name: "release-test",
        targetDir: defaultSandboxDir,
        yes: false,
        force: false,
        skipBuild: false,
        ccaArgs: [],
    }

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]

        if (arg === "--") {
            options.ccaArgs.push(...argv.slice(index + 1))
            break
        }

        if (arg === "--help" || arg === "-h") {
            usage()
            process.exit(0)
        }

        if (arg === "--name") {
            options.name = readValue(argv, (index += 1), "--name")
        } else if (arg === "--target-dir") {
            const targetDir = readValue(argv, (index += 1), "--target-dir")
            options.targetDir = path.isAbsolute(targetDir) ? targetDir : `${repoRoot}${path.sep}${targetDir}`
        } else if (arg === "--yes" || arg === "-y") {
            options.yes = true
        } else if (arg === "--force") {
            options.force = true
        } else if (arg === "--skip-build") {
            options.skipBuild = true
        } else {
            options.ccaArgs.push(arg)
        }
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(options.name)) {
        throw new Error(`Invalid sandbox app name "${options.name}"`)
    }

    return options
}

function readValue(argv, index, flag) {
    const value = argv[index]
    if (!value || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`)
    }
    return value
}

function run(command, args, options = {}) {
    const env = {
        ...process.env,
        ...(options.env || {}),
        npm_config_cache: npmCacheDir,
        NPM_CONFIG_CACHE: npmCacheDir,
    }

    let result
    if (command === "npm") {
        result = spawnSync(npmCommand, args, {
            cwd: repoRoot,
            stdio: "inherit",
            ...options,
            env,
        })
    } else if (command === "node") {
        result = spawnSync(process.execPath, args, {
            cwd: repoRoot,
            stdio: "inherit",
            shell: process.platform === "win32",
            ...options,
            env,
        })
    } else {
        throw new Error(`Unsupported sandbox command: ${command}`)
    }

    if (result.status !== 0) {
        process.exit(result.status || 1)
    }
}

function runCapture(command, args, options = {}) {
    const env = {
        ...process.env,
        ...(options.env || {}),
        npm_config_cache: npmCacheDir,
        NPM_CONFIG_CACHE: npmCacheDir,
    }

    let result
    if (command === "npm") {
        result = spawnSync(npmCommand, args, {
            cwd: repoRoot,
            encoding: "utf8",
            ...options,
            env,
        })
    } else if (command === "node") {
        result = spawnSync(process.execPath, args, {
            cwd: repoRoot,
            encoding: "utf8",
            shell: process.platform === "win32",
            ...options,
            env,
        })
    } else {
        throw new Error(`Unsupported sandbox command: ${command}`)
    }

    if (result.status !== 0) {
        process.stdout.write(result.stdout || "")
        process.stderr.write(result.stderr || "")
        process.exit(result.status || 1)
    }

    return result.stdout.trim()
}

function copyDirectory(source, destination) {
    fs.rmSync(destination, { recursive: true, force: true })
    fs.cpSync(source, destination, {
        recursive: true,
        filter: (sourcePath) => {
            const relativePath = path.relative(source, sourcePath)
            const parts = relativePath.split(path.sep)
            return !parts.includes("node_modules") && !parts.includes("dist")
        },
    })
}

function patchTemplatePackage(templatePackagePath, coreSpec) {
    const packageJson = JSON.parse(fs.readFileSync(templatePackagePath, "utf8"))
    packageJson.dependencies = packageJson.dependencies || {}

    if (!packageJson.dependencies["catalyst-core"]) {
        throw new Error(`${templatePackagePath} does not depend on catalyst-core`)
    }

    packageJson.dependencies["catalyst-core"] = coreSpec
    fs.writeFileSync(templatePackagePath, `${JSON.stringify(packageJson, null, 4)}\n`)
}

function patchCcaTemplates(ccaCopyDir, coreSpec) {
    const templatesDir = `${ccaCopyDir}${path.sep}templates`
    const templateDirs = fs
        .readdirSync(templatesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((templateDir) =>
            fs.existsSync(`${templatesDir}${path.sep}${templateDir}${path.sep}package.json`)
        )

    for (const templateDir of templateDirs) {
        patchTemplatePackage(`${templatesDir}${path.sep}${templateDir}${path.sep}package.json`, coreSpec)
    }
}

function main() {
    const options = parseArgs(process.argv.slice(2))
    const sandboxDir = options.targetDir
    const appDir = path.join(sandboxDir, options.name)
    const ccaCreatedName = options.yes ? "my-app" : options.name
    const ccaCreatedDir = path.join(sandboxDir, ccaCreatedName)
    const artifactsDir = path.join(sandboxDir, ".artifacts", options.name)
    const ccaCopyDir = path.join(artifactsDir, "create-catalyst-app")

    if (fs.existsSync(appDir) && !options.force) {
        throw new Error(`${appDir} already exists. Use --force to recreate it.`)
    }

    if (ccaCreatedDir !== appDir && fs.existsSync(ccaCreatedDir) && !options.force) {
        throw new Error(`${ccaCreatedDir} already exists. Use --force to recreate it.`)
    }

    fs.mkdirSync(sandboxDir, { recursive: true })

    if (options.force) {
        fs.rmSync(appDir, { recursive: true, force: true })
        if (ccaCreatedDir !== appDir) {
            fs.rmSync(ccaCreatedDir, { recursive: true, force: true })
        }
        fs.rmSync(artifactsDir, { recursive: true, force: true })
    }

    fs.mkdirSync(artifactsDir, { recursive: true })

    console.log("Building catalyst-core from current branch...")
    run("npm", ["run", "prepare", "--workspace", "packages/catalyst-core"])

    console.log("Packing local catalyst-core...")
    const coreTarballName = runCapture("npm", [
        "pack",
        "--workspace",
        "packages/catalyst-core",
        "--pack-destination",
        artifactsDir,
        "--silent",
    ])
    const coreTarballPath = path.join(artifactsDir, coreTarballName.split("\n").pop())
    const coreSpec = `file:${coreTarballPath}`

    console.log("Preparing temporary create-catalyst-app package...")
    copyDirectory(ccaPackageDir, ccaCopyDir)
    patchCcaTemplates(ccaCopyDir, coreSpec)

    console.log("Scaffolding app with current branch create-catalyst-app...")
    const cliPath = path.join(ccaCopyDir, "scripts", "cli.cjs")
    const cliArgs = [cliPath, options.name, ...options.ccaArgs]
    if (options.yes) {
        cliArgs.push("--yes")
    }

    run("node", cliArgs, {
        cwd: sandboxDir,
        env: {
            ...process.env,
            CREATE_CATALYST_APP_PACK_SOURCE: "local",
        },
    })

    if (!fs.existsSync(ccaCreatedDir)) {
        throw new Error(`Expected CCA to create ${ccaCreatedDir}`)
    }

    if (ccaCreatedDir !== appDir) {
        fs.renameSync(ccaCreatedDir, appDir)
    }

    if (!options.skipBuild) {
        console.log("Building sandbox app...")
        run("npm", ["run", "build"], { cwd: appDir })
    }

    console.log(`\nSandbox app ready: ${appDir}`)
    console.log("\nManual test commands:")
    console.log(`  cd ${path.relative(process.cwd(), appDir) || appDir}`)
    console.log("  npm run start")
    console.log("  npm run build")
    console.log("  npm run serve")
}

try {
    main()
} catch (error) {
    console.error(`Error: ${error.message}`)
    process.exit(1)
}
