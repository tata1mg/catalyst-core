import fs from "fs"
import path from "path"
import util from "node:util"
import pkg from "picocolors"
const { gray, cyan } = pkg

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
    const directoryPath = path.join(process.env.src_path, `build/public`)

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
        const fileName = `${gray(`build/public/`)}${cyan(file)}`
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
