#!/usr/bin/env node
const { execSync } = require("child_process")
const Commander = require("commander")
const { Option } = require("commander")
const prompts = require("prompts")
const { red, green, cyan, bold } = require("picocolors")
const tar = require("tar")
const path = require("path")
const fs = require("fs")
var validate = require("validate-npm-package-name")
const packageJson = require("../package.json")
const packageRoot = path.join(__dirname, "..")

function getCatalystPackageName() {
    return packageJson.name === "create-catalyst-app-internal" ? "catalyst-core-internal" : "catalyst-core"
}

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

            console.log(cyan(`Using create-catalyst-app version ${bold(packageJson.version)}`))

            // Use options provided through commander or prompt the user
            validateOptions(cmd)

            if (cmd.yes) {
                console.log("Using default configuration.")
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
            let isNameValid = validate(projectName)
            if (!isNameValid.validForNewPackages) {
                isNameValid?.warnings?.forEach?.((item) => console.log(red(item)))
                isNameValid?.errors?.forEach?.((item) => console.log(red(item)))
                process.exit(1)
            }
            let projectPath = path.join(process.cwd(), projectName)
            if (fs.existsSync(projectPath)) {
                console.log(red(`${projectName} already exists, try again.`))
                process.exit(1)
            }
            const projectDescription = config.description || (await promptDescription())
            const language = config.language || (await promptTypescript())
            const tailWindSupport = config.tailWindSupport !== null || (await promptTailwind())
            const stateManagement = config.stateManagement || (await promptStateManagement())
            const mcpSupport = config.mcpSupport !== null || (await promptMcp())

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

                    execSync(
                        `cd ${projectName} && npm i && npm pkg set name=${projectName} ${projectDescription ? `description="${projectDescription}"` : ""} && git init --quiet`,
                        { stdio: "inherit" }
                    )

                    if (tailWindSupport) {
                        execSync(`cd ${projectName} && npm i tailwindcss@4.1.4 @tailwindcss/postcss@4.1.4`, {
                            stdio: "inherit",
                        })
                    }

                    execSync(
                        `cd ${projectName} && git add . && git commit -m "initial commit from Create Catalyst App"`,
                        {
                            stdio: "inherit",
                        }
                    )

                    console.log(`\n${green(bold("Success!"))} created ${projectName} at ${projectPath}`)
                    console.log("Inside this directory, you can run the following commands.")

                    console.log(cyan(bold(" \n npm run start")))
                    console.log("  Starts the development server ")

                    console.log(cyan(bold("\n npm run build")))
                    console.log("  Bundles the app for production ")

                    console.log(cyan(bold("\n npm run serve")))
                    console.log("  Serves the production build ")

                    console.log("\nWe suggest you to begin, by running")
                    console.log(` ${cyan("cd")} ${projectName} && ${cyan("npm start")} \n\n`)

                    if (mcpSupport) {
                        const catalystPackageName = getCatalystPackageName()
                        const newMcpDir = path.join(
                            process.cwd(),
                            projectName,
                            "node_modules",
                            catalystPackageName,
                            "mcp_v2"
                        )
                        runMcpSetup(newMcpDir, path.join(process.cwd(), projectName))
                    }
                } catch (error) {
                    console.error(`Error: ${error.message}`)
                    process.exit(1)
                } finally {
                    deleteDirectory(tempDir)
                }
            })()
            function packNpmPackage(packageName, packageVersion, tempDir) {
                const tarballFileName = `${packageName}-${packageVersion}.tgz`
                const tarballFilePath = path.join(tempDir, tarballFileName)

                try {
                    if (process.env.CREATE_CATALYST_APP_PACK_SOURCE === "local") {
                        execSync(`npm pack --pack-destination="${tempDir}" --silent`, {
                            cwd: packageRoot,
                        })
                    } else {
                        execSync(`npm pack ${packageName}@${packageVersion} --silent`, {
                            cwd: tempDir,
                        })
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
                        filter: (path, entry) => {
                            return subDirectoriesToExtract.reduce((acc, item) => {
                                return acc || path.startsWith(item)
                            }, false)
                        },
                        cwd: path.join(process.cwd()),
                        onentry: (entry) => {
                            if (entry.path.startsWith(commonCodeDirectory)) {
                                entry.path = entry.path.replace(commonCodeDirectory, extractionDestination)
                            }
                            if (entry.path.startsWith(selectedTemplateCode)) {
                                entry.path = entry.path.replace(selectedTemplateCode, extractionDestination)
                            }
                            if (entry.path.startsWith(tailwindCodeDirectory)) {
                                entry.path = entry.path.replace(tailwindCodeDirectory, extractionDestination)
                            }
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
            const catalystPackageName = getCatalystPackageName()
            const mcpDir = path.join(process.cwd(), "node_modules", catalystPackageName, "mcp_v2")
            const setupPath = path.join(mcpDir, "setup.js")

            if (!fs.existsSync(setupPath)) {
                console.log(cyan(`mcp_v2 not found in ${catalystPackageName}. Downloading from GitHub...`))
                const catalystCoreDir = path.join(process.cwd(), "node_modules", catalystPackageName)
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
    const pkgPath = path.join(mcpDir, "package.json")
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    pkg.dependencies["better-sqlite3"] = "^12.8.0"
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

    const mcpNodeModules = path.join(mcpDir, "node_modules")
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

    execSync(`node ${path.join(mcpDir, "setup.js")}`, { cwd, stdio: "inherit" })
}

async function promptStateManagement() {
    const response = await prompts({
        type: "select",
        name: "stateManagement",
        message: "Choose state management:",
        choices: [
            { title: "Redux", value: "redux" },
            { title: "Redux Toolkit (RTK)", value: "rtk" },
            { title: "None", value: "none" },
        ],
    })

    return response.stateManagement
}
async function promptProjectName() {
    const res = await prompts({
        type: "text",
        name: "path",
        message: "What is your project named?",
        initial: "my-app",
    })

    if (typeof res.path === "string") {
        let projectName = res.path.trim()
        return projectName
    }

    if (!res.path || projectName === "") {
        console.log(
            "\nPlease specify the project directory:\n" +
                `  ${cyan(program.name())} ${green("<project-directory>")}\n` +
                "For example:\n" +
                `  ${cyan(program.name())} ${green("my-next-app")}\n\n` +
                `Run ${cyan(`${program.name()} --help`)} to see all options.`
        )
        process.exit(1)
    }
}

async function promptDescription() {
    const res = await prompts({
        type: "text",
        name: "path",
        message: "What is your project description?",
    })

    if (typeof res.path === "string") {
        return res.path.trim()
    } else return null
}

async function promptTypescript() {
    const response = await prompts({
        type: "select",
        name: "typescript",
        message: "Would you like to use TypeScript?",
        choices: [
            { title: "Yes", value: "ts" },
            { title: "No", value: "js" },
        ],
    })

    return response.typescript
}

async function promptTailwind() {
    const response = await prompts({
        type: "select",
        name: "tailwind",
        message: "Would you like to use Tailwind CSS?",
        choices: [
            { title: "Yes", value: true },
            { title: "No", value: false },
        ],
    })
    return response.tailwind
}

async function promptMcp() {
    const response = await prompts({
        type: "select",
        name: "mcp",
        message: "Would you like to setup an MCP server?",
        choices: [
            { title: "Yes", value: true },
            { title: "No", value: false },
        ],
    })
    return response.mcp
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
            const currentPath = path.join(dirPath, file)
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

    const gitignorePath = path.join(process.cwd(), projectName, ".gitignore")

    if (fs.existsSync(gitignorePath)) {
        console.log(".gitignore already exists. Please rename or remove it before running the script.")
        return
    }

    fs.writeFileSync(gitignorePath, gitiIgnorePatterns.join("\n"))
}
