const { execSync } = require("child_process")
const { runCommand, promptUser } = require("./utils")

async function setupIOSEnvironment() {
    await installIOSSimulator()
    await launchIOSSimulator()
}

async function installIOSSimulator() {
    if (process.platform !== "darwin") {
        console.log("iOS Simulator is only available on macOS.")
        return
    }

    console.log("Checking Xcode Command Line Tools...")
    try {
        execSync("xcode-select -p", { stdio: "ignore" })
        console.log("Xcode Command Line Tools are already installed.")
    } catch (error) {
        console.log("Installing Xcode Command Line Tools...")
        runCommand("xcode-select --install")
    }

    console.log("Checking iOS Simulator...")
    try {
        runCommand("xcodebuild -runFirstLaunch")
    } catch (error) {
        console.log("iOS Simulator is already set up.")
    }

    const runtimes = execSync("xcrun simctl list runtimes --json").toString()
    const parsedRuntimes = JSON.parse(runtimes).runtimes

    console.log("Available iOS Simulator Runtimes:")
    parsedRuntimes.forEach((runtime, index) => {
        console.log(`${index + 1}. ${runtime.name} (${runtime.availability})`)
    })

    console.log("\nNote: Some runtimes might not be manually installable and require Xcode updates.")
    const choice = await promptUser('Enter the number of the runtime you want to use (or "skip" to skip): ')

    if (choice.toLowerCase() !== "skip") {
        const index = parseInt(choice) - 1
        if (index >= 0 && index < parsedRuntimes.length) {
            const selectedRuntime = parsedRuntimes[index]
            console.log(`Selected runtime: ${selectedRuntime.name}`)
            if (selectedRuntime.availability !== "(available)") {
                console.log(
                    `This runtime (${selectedRuntime.name}) is not available. It might require an Xcode update or it's not supported on your system.`
                )
            }
        } else {
            console.log("Invalid choice. No runtime selected.")
            return
        }
    }

    const createSimulator = await promptUser("Do you want to create an iOS simulator? (y/n): ")
    if (createSimulator.toLowerCase() === "y") {
        const simulatorName = await promptUser("Enter a name for the simulator (e.g., iPhone 15 Pro): ")
        const deviceTypes = execSync("xcrun simctl list devicetypes --json").toString()
        const parsedDeviceTypes = JSON.parse(deviceTypes).devicetypes

        console.log("Available device types:")
        parsedDeviceTypes.forEach((deviceType, index) => {
            console.log(`${index + 1}. ${deviceType.name}`)
        })

        const deviceTypeIndex = await promptUser("Enter the number of the device type you want to use: ")
        const runtimeIndex = await promptUser("Enter the number of the runtime you want to use: ")

        const selectedDeviceType = parsedDeviceTypes[parseInt(deviceTypeIndex) - 1]
        const selectedRuntime = parsedRuntimes[parseInt(runtimeIndex) - 1]

        if (selectedDeviceType && selectedRuntime) {
            try {
                runCommand(
                    `xcrun simctl create "${simulatorName}" "${selectedDeviceType.identifier}" "${selectedRuntime.identifier}"`
                )
                console.log(`Simulator "${simulatorName}" created successfully.`)
            } catch (error) {
                console.log(`Failed to create simulator "${simulatorName}". Error: ${error.message}`)
                console.log(
                    "This might be due to an unavailable runtime or incompatible device type and runtime combination."
                )
            }
        } else {
            console.log("Invalid choice. No simulator created.")
        }
    }
}

async function launchIOSSimulator() {
    if (process.platform !== "darwin") {
        console.log("iOS Simulator is only available on macOS.")
        return
    }

    console.log("Launching iOS Simulator...")
    try {
        // List available simulators
        const availableSimulators = runCommand("xcrun simctl list devices available")
        const simulatorLines = availableSimulators.split("\n").filter((line) => line.includes("("))

        if (simulatorLines.length === 0) {
            console.log("No iOS simulators found. Please create a simulator first.")
            return
        }

        console.log("Available iOS Simulators:")
        simulatorLines.forEach((line, index) => {
            console.log(`${index + 1}. ${line.trim()}`)
        })

        const choice = await promptUser("Enter the number of the simulator you want to launch: ")
        const index = parseInt(choice) - 1

        if (index >= 0 && index < simulatorLines.length) {
            const selectedSimulator = simulatorLines[index].split("(")[1].split(")")[0]
            console.log(`Launching simulator: ${selectedSimulator}`)
            runCommand(`xcrun simctl boot ${selectedSimulator}`)
            runCommand("open -a Simulator &")
            console.log("iOS Simulator launched successfully.")
        } else {
            console.log("Invalid choice. No simulator launched.")
        }
    } catch (error) {
        console.error("Failed to launch iOS Simulator. Error:", error.message)
    }
    process.exit(0);
}
setupIOSEnvironment()

// module.exports = {
//     setupIOSEnvironment,
// }
