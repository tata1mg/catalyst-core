import { execSync } from "child_process";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import { runCommand, promptUser, validateAndCompleteConfig } from "./utils.js";

const configPath = `${process.env.PWD}/config/config.json`;
const ITEMS_PER_PAGE = 10;

async function initializeConfig() {
    const configFile = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFile);
    const { WEBVIEW_CONFIG } = config;

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        console.error('WebView Config missing in', configPath);
        process.exit(1);
    }

    if (!WEBVIEW_CONFIG.ios) {
        WEBVIEW_CONFIG.ios = {};
    }

    return { WEBVIEW_CONFIG };
}

async function saveConfig(config) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('Configuration saved successfully.');
    } catch (error) {
        console.error('Failed to save configuration:', error);
        process.exit(1);
    }
}

async function setupIOSEnvironment() {
    if (process.platform !== "darwin") {
        console.log("iOS Simulator is only available on macOS.");
        process.exit(1);
    }

    const { WEBVIEW_CONFIG } = await initializeConfig();
    await configureSimulator(WEBVIEW_CONFIG);
    await launchIOSSimulator(WEBVIEW_CONFIG.ios.simulatorName);
    const config = await validateAndCompleteConfig('ios', configPath);    
    
    console.log('\nConfiguration Explanation:');
    console.log('WEBVIEW_CONFIG: Main configuration object for the WebView setup');
    console.log('├─ port: Port number for the WebView server');
    console.log('└─ ios: iOS-specific configuration');
    console.log('   ├─ buildType: Build type (debug/release)');
    console.log('   ├─ appBundleId: iOS application bundle identifier');
    console.log('   └─ simulatorName: Selected iOS simulator name');

    console.log('\nFinal Configuration:');
    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
}

async function getRuntime() {
    const runtimesOutput = execSync("xcrun simctl list runtimes -j").toString();
    const parsedRuntimes = JSON.parse(runtimesOutput).runtimes;
    
    const availableRuntime = parsedRuntimes.find(runtime => 
        runtime.isAvailable || 
        runtime.availability === "(available)" || 
        runtime.availability === "available"
    );

    if (!availableRuntime) {
        const runningSimulators = execSync("xcrun simctl list devices booted").toString();
        if (runningSimulators.includes("(Booted)") && parsedRuntimes.length > 0) {
            console.log(`Using runtime: ${parsedRuntimes[0].name}`);
            return parsedRuntimes[0];
        }
        
        console.error("No available iOS runtime found. Please install one through Xcode.");
        process.exit(1);
    }

    console.log(`Using runtime: ${availableRuntime.name}`);
    return availableRuntime;
}

async function displayPaginatedList(items, startIndex) {
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, items.length);
    
    for (let i = startIndex; i < endIndex; i++) {
        console.log(`${i + 1}. ${items[i]}`);
    }
    
    if (endIndex < items.length) {
        console.log(`\nShowing ${startIndex + 1}-${endIndex} of ${items.length} items`);
        console.log('Type "more" to see more items, or enter your selection: ');
        return true;
    }
    
    return false;
}

async function configureSimulator(config) {
    const availableSimulators = runCommand("xcrun simctl list devices available");
    const simulatorLines = availableSimulators.split("\n")
        .filter((line) => line.includes("("))
        .map(line => line.trim());

    let startIndex = 0;
    console.log("\nAvailable simulators (or type 'new' to create a new one):");
    
    while (true) {
        const hasMore = await displayPaginatedList(simulatorLines, startIndex);
        const simulatorChoice = await promptUser(hasMore ? "" : "\nEnter selection: ");

        if (simulatorChoice.toLowerCase() === 'more' && hasMore) {
            startIndex += ITEMS_PER_PAGE;
            continue;
        }

        if (simulatorChoice.toLowerCase() === 'new') {
            const deviceTypes = JSON.parse(execSync("xcrun simctl list devicetypes --json").toString()).devicetypes;
            const simulatorName = await promptUser("Enter a name for the new simulator: ");
            const runtime = await getRuntime();
            
            // Use iPhone 15 Pro as default device type
            const defaultDevice = deviceTypes.find(dt => dt.name.includes("iPhone 15 Pro")) || deviceTypes[0];
            
            try {
                runCommand(
                    `xcrun simctl create "${simulatorName}" "${defaultDevice.identifier}" "${runtime.identifier}"`
                );
                console.log(`Simulator "${simulatorName}" created successfully.`);
                config.ios.simulatorName = simulatorName;
            } catch (error) {
                console.log(`Failed to create simulator "${simulatorName}". Error: ${error.message}`);
                process.exit(1);
            }
            break;
        } else {
            const index = parseInt(simulatorChoice) - 1;
            if (index >= 0 && index < simulatorLines.length) {
                const selectedSimulator = simulatorLines[index];
                // Extract only the simulator name without ID and state
                const simulatorName = selectedSimulator.split(" (")[0];
                config.ios.simulatorName = simulatorName;
                break;
            } else {
                console.log("Invalid selection. Please try again.");
            }
        }
    }

    await saveConfig({ WEBVIEW_CONFIG: config });
}


async function launchIOSSimulator(simulatorName) {
    console.log("Launching iOS Simulator...");
    try {
        // Get all simulators including both available and booted ones
        const allSimulatorInfo = execSync("xcrun simctl list devices -j").toString();
        const simulatorsJson = JSON.parse(allSimulatorInfo);
        
        // Search through all runtimes and their devices
        let foundSimulator = null;
        let foundSimulatorId = null;
        let isBooted = false;

        // Iterate through all runtimes and their devices
        Object.values(simulatorsJson.devices).forEach(devices => {
            devices.forEach(device => {
                if (device.name === simulatorName) {
                    foundSimulator = device;
                    foundSimulatorId = device.udid;
                    isBooted = device.state === "Booted";
                }
            });
        });

        if (!foundSimulator) {
            console.log(`Configured simulator "${simulatorName}" not found.`);
            return;
        }

        if (!isBooted) {
            console.log(`Booting simulator: ${simulatorName}`);
            runCommand(`xcrun simctl boot ${foundSimulatorId}`);
        } else {
            console.log(`Simulator ${simulatorName} is already booted`);
        }

        // Open Simulator.app and focus
        console.log("Opening Simulator.app...");
        runCommand("open -a Simulator");
        
        // Give the simulator a moment to open/focus
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Activate the Simulator.app window to bring it to front
        runCommand("osascript -e 'tell application \"Simulator\" to activate'");
        
        console.log("iOS Simulator launched successfully.");
    } catch (error) {
        console.error("Failed to launch iOS Simulator. Error:", error.message);
    }
    // process.exit(0);
}


// Execute the main setup
setupIOSEnvironment();