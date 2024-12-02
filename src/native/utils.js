const { execSync, spawn } = require("child_process")
const readline = require("readline")

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})

function runCommand(command) {
    try {
        return execSync(command, { encoding: "utf8" })
    } catch (error) {
        console.error(`Error executing command: ${command}`)
        console.error(`Error message: ${error.message}`)
        throw error
    }
}

function commandExists(command) {
    try {
        execSync(`which ${command}`, { stdio: "ignore" })
        return true
    } catch (error) {
        return false
    }
}

async function promptUser(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim())
        })
    })
}

async function runInteractiveCommand(command, args, promptResponses = {}) {
    return new Promise((resolve, reject) => {
        const process = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })

        let buffer = ""
        let outputBuffer = ""

        process.stdout.on("data", (data) => {
            buffer += data.toString()
            outputBuffer += data.toString()
            console.log(data.toString())
            handlePrompts(process, buffer, promptResponses)
        })

        process.stderr.on("data", (data) => {
            buffer += data.toString()
            outputBuffer += data.toString()
            console.error(data.toString())
            handlePrompts(process, buffer, promptResponses)
        })

        process.on("close", (code) => {
            if (code === 0) {
                resolve(outputBuffer)
            } else {
                reject(new Error(`Command failed with exit code ${code}`))
            }
        })
    })
}

function handlePrompts(process, buffer, promptResponses) {
    for (const [prompt, response] of Object.entries(promptResponses)) {
        if (buffer.includes(prompt)) {
            process.stdin.write(response + "\n")
            return
        }
    }
}

async function runSdkManagerCommand(sdkManagerPath, args) {
    const promptResponses = {
        "(y/N)": "y",
        "Accept? (y/N):": "y",
    }
    return runInteractiveCommand(sdkManagerPath, args, promptResponses)
}

module.exports = {
    runCommand,
    commandExists,
    promptUser,
    runSdkManagerCommand,
    runInteractiveCommand,
}
