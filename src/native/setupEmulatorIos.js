import { execSync } from "child_process";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import { runCommand, promptUser, validateAndCompleteConfig } from "./utils.js";

const configPath =`${process.env.PWD}/config/config.json`;

async function initializeConfig() {
    await validateAndCompleteConfig('ios', configPath);
    const configFile = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFile);
    const { WEBVIEW_CONFIG } = config;

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        console.error('WebView Config missing in', configPath);
        process.exit(1);
    }

    const iosConfig = WEBVIEW_CONFIG.ios;
    if (!iosConfig) {
        console.error('iOS config missing in WebView Config');
        process.exit(1);
    }

    return { iosConfig, WEBVIEW_CONFIG };
}

async function setupIOSEnvironment() {
    if (process.platform !== "darwin") {
        console.log("iOS Simulator is only available on macOS.");
        process.exit(1);
    }

    await initializeConfig();
    await installIOSSimulator();
    await launchIOSSimulator();
}

async function installIOSSimulator() {
    console.log("Checking Xcode Command Line Tools...");
    try {
        execSync("xcode-select -p", { stdio: "ignore" });
        console.log("Xcode Command Line Tools are already installed.");
    } catch (error) {
        console.log("Installing Xcode Command Line Tools...");
        runCommand("xcode-select --install");
    }

    console.log("Checking iOS Simulator...");
    try {
        runCommand("xcodebuild -runFirstLaunch");
    } catch (error) {
        console.log("iOS Simulator is already set up.");
    }

    const runtimes = execSync("xcrun simctl list runtimes --json").toString();
    const parsedRuntimes = JSON.parse(runtimes).runtimes;

    console.log("Available iOS Simulator Runtimes:");
    parsedRuntimes.forEach((runtime, index) => {
        console.log(`${index + 1}. ${runtime.name} (${runtime.availability})`);
    });

    console.log("\nNote: Some runtimes might not be manually installable and require Xcode updates.");
    const choice = await promptUser('Enter the number of the runtime you want to use (or "skip" to skip): ');

    if (choice.toLowerCase() !== "skip") {
        const index = parseInt(choice) - 1;
        if (index >= 0 && index < parsedRuntimes.length) {
            const selectedRuntime = parsedRuntimes[index];
            console.log(`Selected runtime: ${selectedRuntime.name}`);
            if (selectedRuntime.availability !== "(available)") {
                console.log(
                    `This runtime (${selectedRuntime.name}) is not available. It might require an Xcode update or it's not supported on your system.`
                );
            }
        } else {
            console.log("Invalid choice. No runtime selected.");
            return;
        }
    }

    const createSimulator = await promptUser("Do you want to create an iOS simulator? (y/n): ");
    if (createSimulator.toLowerCase() === "y") {
        const { iosConfig } = await initializeConfig();
        const simulatorName = iosConfig.simulatorName;
        
        const deviceTypes = execSync("xcrun simctl list devicetypes --json").toString();
        const parsedDeviceTypes = JSON.parse(deviceTypes).devicetypes;

        console.log("Available device types:");
        parsedDeviceTypes.forEach((deviceType, index) => {
            console.log(`${index + 1}. ${deviceType.name}`);
        });

        const deviceTypeIndex = await promptUser("Enter the number of the device type you want to use: ");
        const runtimeIndex = await promptUser("Enter the number of the runtime you want to use: ");

        const selectedDeviceType = parsedDeviceTypes[parseInt(deviceTypeIndex) - 1];
        const selectedRuntime = parsedRuntimes[parseInt(runtimeIndex) - 1];

        if (selectedDeviceType && selectedRuntime) {
            try {
                runCommand(
                    `xcrun simctl create "${simulatorName}" "${selectedDeviceType.identifier}" "${selectedRuntime.identifier}"`
                );
                console.log(`Simulator "${simulatorName}" created successfully.`);
            } catch (error) {
                console.log(`Failed to create simulator "${simulatorName}". Error: ${error.message}`);
                console.log(
                    "This might be due to an unavailable runtime or incompatible device type and runtime combination."
                );
            }
        } else {
            console.log("Invalid choice. No simulator created.");
        }
    }
}

async function launchIOSSimulator() {
    const { iosConfig } = await initializeConfig();
    
    console.log("Launching iOS Simulator...");
    try {
        // List available simulators
        const availableSimulators = runCommand("xcrun simctl list devices available");
        const simulatorLines = availableSimulators.split("\n").filter((line) => line.includes("("));

        if (simulatorLines.length === 0) {
            console.log("No iOS simulators found. Please create a simulator first.");
            return;
        }

        // Find the configured simulator
        const configuredSimulatorLine = simulatorLines.find(line => line.includes(iosConfig.simulatorName));
        if (!configuredSimulatorLine) {
            console.log(`Configured simulator "${iosConfig.simulatorName}" not found. Available simulators:`);
            simulatorLines.forEach((line, index) => {
                console.log(`${index + 1}. ${line.trim()}`);
            });
            return;
        }

        const simulatorId = configuredSimulatorLine.split("(")[1].split(")")[0];
        console.log(`Launching simulator: ${iosConfig.simulatorName}`);
        runCommand(`xcrun simctl boot ${simulatorId}`);
        runCommand("open -a Simulator &");
        console.log("iOS Simulator launched successfully.");
    } catch (error) {
        console.error("Failed to launch iOS Simulator. Error:", error.message);
    }
    process.exit(0);
}

// Execute the main setup
setupIOSEnvironment();

// Export functions for potential external use
export {
    setupIOSEnvironment,
};