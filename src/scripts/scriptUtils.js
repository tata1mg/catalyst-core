const fs = require("fs")
const path = require("path")
const util = require("node:util")
const { spawnSync } = require("child_process")
const { gray, cyan } = require("picocolors")
const { BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

// Function to get file size synchronously
function getFileSizeSync(filePath) {
    try {
        const stats = fs.statSync(filePath)
        return stats.size
    } catch (err) {
        console.error(`Error getting bundle information for file ${filePath}: ${err}`)
        return null
    }
}

export const printBundleInformation = () => {
    let bundleList = []
    const directoryPath = path.join(process.cwd(), `${BUILD_OUTPUT_PATH}/public`)

    try {
        const files = fs.readdirSync(directoryPath)
        files.forEach((file) => {
            if (!file.includes("txt") && !file.includes("json")) {
                const filePath = path.join(directoryPath, file)
                const fileSize = getFileSizeSync(filePath)
                if (fileSize !== null) {
                    bundleList.push({ file, fileSize })
                }
            }
        })
    } catch (err) {
        console.error("Unable to scan build folder: " + err)
    }

    bundleList.sort((a, b) => b.fileSize - a.fileSize)
    bundleList.forEach(({ file, fileSize }) => {
        const fileName = `${gray(`${BUILD_OUTPUT_PATH}/public/`)}${cyan(file)}`
        const fileSizeInKb = (fileSize / 1024).toFixed(2)
        const size = `\t${fileSizeInKb} kB`.padEnd(16)

        console.log(util.format(size, fileName))
    })
}

export function arrayToObject(array) {
    const obj = {}
    array.forEach((item) => {
        const [key, value] = item.split("=")
        if (value) obj[key] = value
    })
    return obj
}

const BUILD_FAILURE_MESSAGE = "\nBuild Failed!"

function shouldFailBuild(result) {
    return (
        result.error ||
        result.signal ||
        (result.status !== null && result.status !== 0)
    )
}

function logBuildFailure(result, failureMessage = BUILD_FAILURE_MESSAGE) {
    console.error(failureMessage)

    if (result.error) {
        console.error(`Error: ${result.error?.message || result.error}\n`)
    }

    if (result.signal) {
        console.error(`Signal: ${result.signal}\n`)
    }

    if (result.status !== null) {
        console.error(`Exit code: ${result.status}\n`)
    }
}

export const runBuildCommands = ({ commands, cwd, env, failureMessage = BUILD_FAILURE_MESSAGE }) => {
    const command = commands.join(" && ")

    const result = spawnSync(command, [], {
        cwd,
        stdio: "inherit",
        shell: true,
        env,
    })

    if (shouldFailBuild(result)) {
        logBuildFailure(result, failureMessage)
        process.exit(result.status || 1)
    }

    return result
}
