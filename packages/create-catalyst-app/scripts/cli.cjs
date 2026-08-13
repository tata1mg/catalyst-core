#!/usr/bin/env node
const { execFileSync, execSync } = require("child_process")
const Commander = require("commander")
const { Option } = require("commander")
const clack = require("@clack/prompts")
const { red, green, cyan, gray, bold } = require("picocolors")
const tar = require("tar")
const path = require("path")
const fs = require("fs")
var validate = require("validate-npm-package-name")
const packageJson = require("../package.json")
const packageRoot = path.join(__dirname, "..")
const executable = (command) => (process.platform === "win32" ? `${command}.cmd` : command)

let projectName = null
const program = new Commander.Command()
    .version(packageJson.version)
    .description("Scaffolding")
    .arguments("[folderName]")
    .usage(`${green("[folderName]")} [options]`)
    .action((name) => (projectName = name))
    .addOption(new Option("-y, --yes [yes]", "Use default configuration"))
    .addOption(
        new Option(
            "-s, --state-management [stateManagement]",
            "Specify state management (rtk, redux, or none)",
            /^(rtk|redux|none)$/i,
            "none"
        )
    )
    .action(async (folderName = null, cmd) => {
        try {
            let config = {
                folderName,
                language: null,
                tailWindSupport: null,
                description: null,
                stateManagement: cmd.stateManagement,
                mcpSupport: null,
            }

            if (process.argv.includes("new-route")) {
                const createRoutePath = path.join(__dirname, "../codemod/new-route/index.js")
                execSync(`node ${createRoutePath}`, { stdio: "inherit" })
                return
            }

            // Same identity as every other Catalyst command: accent-coloured
            // name, dim version.
            clack.intro(`${cyan(bold("create-catalyst-app"))} ${gray(packageJson.version)}`)

            // Use options provided through commander or prompt the user
            validateOptions(cmd)

            if (cmd.yes) {
                clack.log.info("Using default configuration")
                config = {
                    folderName: "my-app",
                    language: "js",
                    tailWindSupport: false,
                    description: "Default catalyst app",
                    stateManagement: "none",
                    mcpSupport: true,
                }
            }

            const projectName = config.folderName || (await promptProjectName())

            // Still needed for --yes and for a name passed as an argument:
            // those paths never reach the prompt's own validation.
            const isNameValid = validate(projectName)
            if (!isNameValid.validForNewPackages) {
                const reasons = [...(isNameValid.errors || []), ...(isNameValid.warnings || [])]
                clack.cancel(`"${projectName}" is not a valid package name: ${reasons.join(", ")}`)
                process.exit(1)
            }
            let projectPath = path.join(process.cwd(), projectName)
            if (fs.existsSync(projectPath)) {
                clack.cancel(`${projectName} already exists — choose another name or remove it.`)
                process.exit(1)
            }
            const projectDescription = config.description || (await promptDescription())
            const language = config.language || (await promptTypescript())
            // These are booleans, so `!== null` collapsed a configured `false`
            // into `true` -- `--yes` installed Tailwind against its own default.
            // Only fall through to the prompt when nothing was configured.
            const tailWindSupport =
                config.tailWindSupport != null ? config.tailWindSupport : await promptTailwind()
            const stateManagement = config.stateManagement || (await promptStateManagement())
            const mcpSupport = config.mcpSupport != null ? config.mcpSupport : await promptMcp()

            // Define mapping of options to repository suffixes
            const repositorySuffixes = {
                js: "js",
                ts: "ts",
                redux: "redux",
                rtk: "rtk",
                none: "none",
            }

            const packageName = packageJson.name
            const packageVersion = packageJson.version

            const commonCodeDirectory = "package/templates/common"
            const selectedTemplateCode = `package/templates/${repositorySuffixes[stateManagement]}-${repositorySuffixes[language]}`
            const tailwindCodeDirectory = "package/templates/tailwind"
            const subDirectoriesToExtract = [commonCodeDirectory, selectedTemplateCode]
            if (tailWindSupport) subDirectoriesToExtract.push(tailwindCodeDirectory)

            const extractionDestination = `/${projectName}/`
            let tempDir
            ;(() => {
                try {
                    tempDir = createTempDir()

                    const packageFilePath = packNpmPackage(packageName, packageVersion, tempDir)

                    extractSubdirectory(packageFilePath)
                    createGitignore(projectName)

                    // npm's install output is hundreds of lines nobody reads
                    // when it works. Fold it behind a spinner, and print it in
                    // full only if the step actually fails.
                    runStep(`Installing dependencies`, () => {
                        runQuiet(
                            `cd ${projectName} && npm i && npm pkg set name=${projectName} ${projectDescription ? `description="${projectDescription}"` : ""} && git init --quiet`
                        )
                    })

                    if (tailWindSupport) {
                        runStep("Adding Tailwind CSS", () => {
                            runQuiet(
                                `cd ${projectName} && npm i tailwindcss@4.1.4 @tailwindcss/postcss@4.1.4`
                            )
                        })
                    }

                    runStep("Creating initial commit", () => {
                        runQuiet(
                            `cd ${projectName} && git add . && git commit -m "initial commit from Create Catalyst App"`
                        )
                    })

                    if (mcpSupport) {
                        const newMcpDir = path.join(
                            process.cwd(),
                            projectName,
                            "node_modules",
                            "catalyst-core",
                            "mcp_v2"
                        )
                        runMcpSetup(newMcpDir, path.join(process.cwd(), projectName))
                    }

                    clack.note(
                        [
                            `${cyan("npm start".padEnd(16))}${gray("Start the development server")}`,
                            `${cyan("npm run build".padEnd(16))}${gray("Bundle the app for production")}`,
                            `${cyan("npm run serve".padEnd(16))}${gray("Serve the production build")}`,
                        ].join("\n"),
                        `Created ${bold(projectName)}`
                    )

                    clack.outro(`Next: ${cyan(`cd ${projectName}`)} && ${cyan("npm start")}`)
                } catch (error) {
                    // The step that failed already printed its own output.
                    clack.cancel(`Could not create ${projectName}: ${error.message}`)
                    process.exit(1)
                } finally {
                    deleteDirectory(tempDir)
                }
            })()
            function packNpmPackage(packageName, packageVersion, tempDir) {
                const tarballFileName = `${packageName}-${packageVersion}.tgz`
                const tarballFilePath = `${tempDir}${path.sep}${tarballFileName}`

                try {
                    if (process.env.CREATE_CATALYST_APP_PACK_SOURCE === "local") {
                        execFileSync(
                            executable("npm"),
                            ["pack", `--pack-destination=${tempDir}`, "--silent"],
                            {
                                cwd: packageRoot,
                            }
                        )
                    } else {
                        execFileSync(
                            executable("npm"),
                            ["pack", `${packageName}@${packageVersion}`, "--silent"],
                            {
                                cwd: tempDir,
                            }
                        )
                    }

                    return tarballFilePath
                } catch (error) {
                    console.error(`Error packing npm package: ${error.message}`)
                    throw error
                }
            }

            // Function to create a temporary directory
            function createTempDir() {
                const tempDir = fs.mkdtempSync(path.join(process.cwd(), "temp-"))

                return tempDir
            }

            // Function to extract subdirectory from npm package and delete tar file
            function extractSubdirectory(packageFilePath) {
                try {
                    tar.extract({
                        file: packageFilePath,
                        sync: true,
                        cwd: path.join(process.cwd()),
                        filter: (entryPath, entry) => {
                            const shouldExtract = subDirectoriesToExtract.reduce((acc, item) => {
                                return acc || entryPath.startsWith(item)
                            }, false)
                            if (!shouldExtract) return false
                            if (entry.path.startsWith(commonCodeDirectory)) {
                                entry.path = entry.path.replace(commonCodeDirectory, extractionDestination)
                            } else if (entry.path.startsWith(selectedTemplateCode)) {
                                entry.path = entry.path.replace(selectedTemplateCode, extractionDestination)
                            } else if (entry.path.startsWith(tailwindCodeDirectory)) {
                                entry.path = entry.path.replace(tailwindCodeDirectory, extractionDestination)
                            }
                            return true
                        },
                    })
                } catch (e) {
                    console.log("An error occurred", e)
                }

                console.log(cyan(`Run cd ${projectName} && npm start to get started.`))
            }
        } catch (error) {
            console.error(red("An error occurred:"), error.message)
            process.exit(1)
        }
    })
    .allowUnknownOption()

program
    .command("catalyst-mcp")
    .description("Set up MCP server in an existing catalyst project")
    .action(() => {
        try {
            const mcpDir = path.join(process.cwd(), "node_modules", "catalyst-core", "mcp_v2")
            const setupPath = path.join(mcpDir, "setup.js")

            if (!fs.existsSync(setupPath)) {
                console.log(cyan("mcp_v2 not found in catalyst-core. Downloading from GitHub..."))
                const catalystCoreDir = path.join(process.cwd(), "node_modules", "catalyst-core")
                const tarballUrl = "https://github.com/tata1mg/catalyst-core/archive/refs/heads/main.tar.gz"
                const tarballPath = path.join(catalystCoreDir, "_mcp_v2_tarball.tar.gz")
                const repoMcpDir = "catalyst-core-main/packages/catalyst-core/mcp_v2"
                execSync(`curl -fsSL "${tarballUrl}" -o "${tarballPath}"`, { stdio: "inherit" })
                fs.mkdirSync(mcpDir, { recursive: true })
                tar.extract({
                    file: tarballPath,
                    cwd: mcpDir,
                    sync: true,
                    strip: 4,
                    filter: (entryPath) => entryPath === repoMcpDir || entryPath.startsWith(`${repoMcpDir}/`),
                })
                fs.unlinkSync(tarballPath)
                console.log(cyan("mcp_v2 downloaded successfully."))
            }

            runMcpSetup(mcpDir)
        } catch (error) {
            console.error(red("An error occurred:"), error.message)
            process.exit(1)
        }
    })

program.parse(process.argv)

function runMcpSetup(mcpDir, cwd = process.cwd()) {
    const pkgPath = `${mcpDir}${path.sep}package.json`
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    pkg.dependencies["better-sqlite3"] = "^12.8.0"
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

    const mcpNodeModules = `${mcpDir}${path.sep}node_modules`
    let needsInstall = !fs.existsSync(mcpNodeModules)

    if (!needsInstall) {
        try {
            execSync(`node -e "require('better-sqlite3')"`, { cwd: mcpDir, stdio: "pipe" })
        } catch {
            console.log(cyan("Detected incompatible better-sqlite3 build. Reinstalling..."))
            fs.rmSync(mcpNodeModules, { recursive: true, force: true })
            needsInstall = true
        }
    }

    if (needsInstall) {
        console.log(cyan("Installing mcp_v2 dependencies..."))
        execSync("npm install", { cwd: mcpDir, stdio: "inherit" })
    }

    execFileSync(process.execPath, [`${mcpDir}${path.sep}setup.js`], { cwd, stdio: "inherit" })
}

/**
 * Run a command with its output captured rather than inherited.
 *
 * On failure the captured output is printed, so a broken install still shows
 * npm's actual error instead of just a non-zero exit code.
 */
function runQuiet(command) {
    try {
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Internal scaffolding commands built from a validated project name.
        return execSync(command, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" })
    } catch (error) {
        const details = [error.stdout, error.stderr].filter(Boolean).join("\n").trim()
        if (details) {
            process.stderr.write(`\n${details}\n`)
        }
        throw error
    }
}

/**
 * Announce a step, run it, and report the outcome.
 *
 * Deliberately not clack's spinner: the work below is synchronous (execSync),
 * so a spinner's timer never fires and the user stares at one frozen frame for
 * the whole of `npm i` -- which reads as a hang. A static line that says what
 * is happening is honest; a stopped animation is not.
 */
function runStep(message, fn) {
    // Announced before, not after: the work below is synchronous (execSync),
    // so nothing else can report progress while `npm i` runs for minutes. One
    // line per step -- the failure branch is what changes the outcome, and it
    // says so explicitly.
    clack.log.step(message)
    try {
        return fn()
    } catch (error) {
        clack.log.error(`${message} failed`)
        throw error
    }
}

/**
 * Exit cleanly when the user hits Ctrl-C.
 *
 * The previous prompt library returned undefined on cancel and the scaffolder
 * carried on with it, producing a half-configured project from an answer the
 * user never gave.
 */
function exitIfCancelled(value) {
    if (clack.isCancel(value)) {
        clack.cancel("Cancelled — nothing was created.")
        process.exit(130)
    }
    return value
}

async function promptStateManagement() {
    return exitIfCancelled(
        await clack.select({
            message: "Choose state management",
            options: [
                { value: "none", label: "None" },
                { value: "redux", label: "Redux" },
                { value: "rtk", label: "Redux Toolkit (RTK)" },
            ],
            initialValue: "none",
        })
    )
}

async function promptProjectName() {
    return exitIfCancelled(
        await clack.text({
            message: "What is your project named?",
            placeholder: "my-app",
            defaultValue: "my-app",
            validate(value) {
                const name = (value || "my-app").trim()
                const result = validate(name)
                if (!result.validForNewPackages) {
                    return (result.errors || result.warnings || ["Invalid package name"])[0]
                }
                if (fs.existsSync(path.join(process.cwd(), name))) {
                    return `${name} already exists in this directory`
                }
                return undefined
            },
        })
    ).trim()
}

async function promptDescription() {
    const value = exitIfCancelled(
        await clack.text({
            message: "What is your project description?",
            placeholder: "optional",
            defaultValue: "",
        })
    )
    return value ? value.trim() : null
}

async function promptTypescript() {
    return exitIfCancelled(
        await clack.select({
            message: "Would you like to use TypeScript?",
            options: [
                { value: "js", label: "JavaScript" },
                { value: "ts", label: "TypeScript" },
            ],
            initialValue: "js",
        })
    )
}

async function promptTailwind() {
    return exitIfCancelled(
        await clack.confirm({
            message: "Would you like to use Tailwind CSS?",
            initialValue: false,
        })
    )
}

async function promptMcp() {
    return exitIfCancelled(
        await clack.confirm({
            message: "Would you like to set up an MCP server?",
            initialValue: true,
        })
    )
}

function validateOptions(cmd) {
    // Validate language option
    if (cmd.lang && !["js", "ts"].includes(cmd.lang.toLowerCase())) {
        throw new Error('Invalid language option. Use "js" or "ts".')
    }

    // Validate state management option
    if (cmd.stateManagement && !["rtk", "redux", "none"].includes(cmd.stateManagement.toLowerCase())) {
        throw new Error('Invalid state management option. Use "rtk", "redux", or "none".')
    }

    if (cmd.yes && typeof cmd.yes !== "boolean") {
        throw new Error('Invalid option for "yes". Use "-y" or "--yes" to accept defaults.')
    }
}

function deleteDirectory(dirPath) {
    if (dirPath && fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach((file) => {
            const currentPath = `${dirPath}${path.sep}${file}`
            if (fs.lstatSync(currentPath).isDirectory()) {
                deleteDirectory(currentPath)
            } else {
                fs.unlinkSync(currentPath)
            }
        })
        fs.rmdirSync(dirPath)
    }
}

// Function to create a .gitignore file with the hardcoded patterns
function createGitignore(projectName) {
    const gitiIgnorePatterns = ["node_modules", "build", "logs"]

    const gitignorePath = `${process.cwd()}${path.sep}${projectName}${path.sep}.gitignore`

    if (fs.existsSync(gitignorePath)) {
        console.log(".gitignore already exists. Please rename or remove it before running the script.")
        return
    }

    fs.writeFileSync(gitignorePath, gitiIgnorePatterns.join("\n"))
}
