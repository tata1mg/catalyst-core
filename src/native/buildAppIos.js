const { exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`;
const { WEBVIEW_CONFIG } = require(`${process.env.PWD}/config/config.json`);

// Configuration constants
const iosConfig = WEBVIEW_CONFIG.ios;
const url = `http://${getLocalIPAddress()}:${WEBVIEW_CONFIG.port}`;
const PROJECT_DIR = `${pwd}/iosnativeWebView`;
const SCHEME_NAME = "iosnativeWebView";
const APP_BUNDLE_ID = iosConfig.appBundleId || "com.debug.webview";
const PROJECT_NAME = path.basename(PROJECT_DIR);
const IPHONE_MODEL = iosConfig.simulatorName;

async function generateConfigConstants() {
    console.log("Generating ConfigConstants.swift...");
    const configOutputPath = path.join(
        PROJECT_DIR,
        PROJECT_NAME,
        "ConfigConstants.swift"
    );
    await runCommand(`swift ${pwd}/build.swift "${url}" "${configOutputPath}"`);
}

async function cleanBuildArtifacts() {
    console.log("Cleaning previous build artifacts...");
    const xcuserdataPath = path.join(
        `${PROJECT_NAME}.xcodeproj`,
        `project.xcworkspace`,
        "xcuserdata"
    );
    if (fs.existsSync(xcuserdataPath)) {
        await runCommand(`rm -rf "${xcuserdataPath}"`);
    }
    
    // Clean DerivedData for this project
    const derivedDataPath = path.join(
        process.env.HOME,
        "Library/Developer/Xcode/DerivedData"
    );
    await runCommand(`rm -rf "${derivedDataPath}/${PROJECT_NAME}-*"`);
    
    try {
        await runCommand(
            `xcodebuild clean -scheme "${SCHEME_NAME}" -sdk iphonesimulator -configuration Debug`
        );
    } catch (error) {
        console.log("Error cleaning", error);
    }
}

async function buildXcodeProject() {
    console.log("Building project...");
    const derivedDataPath = path.join(
        process.env.HOME,
        "Library/Developer/Xcode/DerivedData"
    );
    
    try {
        // First try to build with specified simulator model
        await buildProject(
            SCHEME_NAME,
            "iphonesimulator",
            `platform=iOS Simulator,name=${IPHONE_MODEL}`,
            APP_BUNDLE_ID,
            derivedDataPath,
            PROJECT_NAME
        );
    } catch (buildError) {
        // For any error, try using booted device as fallback
        console.log("Build failed with error:", buildError.message);
        console.log("Attempting to build using booted device as fallback...");
        
        const bootedUUID = await getBootedSimulatorUUID(IPHONE_MODEL);
        
        if (bootedUUID) {
            console.log(`Found booted simulator with UUID: ${bootedUUID}`);
            try {
                await buildProject(
                    SCHEME_NAME,
                    "iphonesimulator",
                    `platform=iOS Simulator,id=${bootedUUID}`,
                    APP_BUNDLE_ID,
                    derivedDataPath,
                    PROJECT_NAME
                );
            } catch (fallbackError) {
                console.error("Fallback build also failed:", fallbackError.message);
                throw fallbackError; // If fallback also fails, throw the error
            }
        } else {
            console.error("No booted simulator found for fallback. Original error:", buildError.message);
            throw buildError; // If no booted device found, throw the original error
        }
    }
}

async function findAppPath() {
    const DERIVED_DATA_DIR = path.join(
        process.env.HOME,
        "Library/Developer/Xcode/DerivedData"
      );
      let APP_PATH = "";
  
      try {
        APP_PATH = execSync(
          `find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-*" -prune -not -path "*/Index.noindex*" -path "*/Build/Products/Debug-iphonesimulator/${PROJECT_NAME}.app" -type d | head -n 1`
        )
          .toString()
          .trim();
      } catch (error) {
        console.error("Error finding app path:", error);
      }
  
      if (!APP_PATH) {
  
        try {
          APP_PATH = execSync(
            `find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-*" -name "${PROJECT_NAME}.app" -type d -not -path "*/Index.noindex*" | head -n 1`
          )
            .toString()
            .trim();
        } catch (error) {
          console.error("Error finding fallback app path:", error);
        }
  
        if (!APP_PATH) {
          console.log("No .app file found. Exiting.");
          process.exit(1);
        }
      }

    return APP_PATH;
}

async function findFallbackAppPath(DERIVED_DATA_DIR) {
    try {
        return execSync(
            `find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-*" -name "${PROJECT_NAME}.app" -type d -not -path "*/Index.noindex*" | head -n 1`
        ).toString().trim();
    } catch (error) {
        console.error("Error finding fallback app path:", error);
        return "";
    }
}

async function setupSimulator() {
    console.log(`Checking for ${IPHONE_MODEL} simulator...`);
    let DEVICE_UUID = await findBootedDevice();

    if (!DEVICE_UUID) {
        DEVICE_UUID = await findAndBootDevice();
    } else {
        console.log(`Using already running ${IPHONE_MODEL} simulator.`);
    }

    console.log(`Selected device UUID: ${DEVICE_UUID}`);
    return DEVICE_UUID;
}

async function findBootedDevice() {
    try {
        return execSync(
            `xcrun simctl list devices | grep "${IPHONE_MODEL}" | grep "(Booted)" | grep -E -o -i "([0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12})" | head -n 1`
        ).toString().trim();
    } catch (error) {
        console.error("Error finding booted device:", error);
        return "";
    }
}

async function findAndBootDevice() {
    const DEVICE_UUID = await findAvailableDevice();
    if (!DEVICE_UUID) {
        console.log(`No ${IPHONE_MODEL} simulator found. Please make sure it's available.`);
        process.exit(1);
    }

    await bootSimulator(DEVICE_UUID);
    return DEVICE_UUID;
}

async function findAvailableDevice() {
    try {
        return execSync(
            `xcrun simctl list devices | grep "${IPHONE_MODEL}" | grep -E -o -i "([0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12})" | head -n 1`
        ).toString().trim();
    } catch (error) {
        console.error("Error finding available device:", error);
        return "";
    }
}

async function bootSimulator(deviceUUID) {
    console.log("Booting the simulator...");
    await runCommand(`xcrun simctl boot "${deviceUUID}"`);
    await waitForSimulatorBoot(deviceUUID);
}

async function waitForSimulatorBoot(deviceUUID) {
    console.log("Waiting for simulator to boot...");
    const boot_timeout = 60;
    const boot_start_time = Date.now();

    while (true) {
        const elapsed_time = Math.floor((Date.now() - boot_start_time) / 1000);

        if (elapsed_time >= boot_timeout) {
            console.log(`Error: Simulator boot timeout after ${boot_timeout} seconds.`);
            process.exit(1);
        }

        const boot_status = execSync(
            `xcrun simctl list devices | grep "${deviceUUID}" | awk '{print $NF}' | tr -d '()'`
        ).toString().trim();

        if (boot_status === "Booted") {
            console.log("Simulator booted successfully.");
            break;
        }

        console.log(`Waiting for simulator to boot... (${elapsed_time}s)`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }
}

async function installAndLaunchApp(APP_PATH) {
    await uninstallExistingApp();
    await installApp(APP_PATH);
    await waitForInstallation();
    await launchAndVerifyApp();
    await focusSimulator();
}

async function uninstallExistingApp() {
    console.log("Uninstalling the app if it exists...");
    await runCommand(`xcrun simctl uninstall booted "${APP_BUNDLE_ID}"`);
}

async function installApp(APP_PATH) {
    console.log("Installing the app...");
    try {
        await runCommand(`xcrun simctl install booted "${APP_PATH}"`);
    } catch (error) {
        console.error("Error installing the app:", error);
        process.exit(1);
    }
}

async function waitForInstallation() {
    console.log("Waiting for the app to be fully installed...");
    for (let i = 0; i < 30; i++) {
        try {
            execSync(`xcrun simctl get_app_container booted "${APP_BUNDLE_ID}"`);
            console.log("App installed successfully.");
            break;
        } catch (error) {
            if (i === 29) {
                console.log("Timeout: App installation took too long.");
                process.exit(1);
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}

async function launchAndVerifyApp() {
    console.log("Launching the app...");
    try {
        await runCommand(`xcrun simctl launch booted "${APP_BUNDLE_ID}"`);
        await verifyAppLaunch();
    } catch (error) {
        await handleLaunchError(error);
    }
}

async function verifyAppLaunch() {
    console.log("Waiting for the app to launch...");
    for (let i = 0; i < 10; i++) {
        try {
            const launchResult = execSync(
                `xcrun simctl launch booted "${APP_BUNDLE_ID}"`
            ).toString();
            if (launchResult.includes("already launched")) {
                console.log("App launched successfully.");
                break;
            }
        } catch (error) {
            if (i === 9) {
                console.log("Warning: App launch might have failed or taken too long.");
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

async function handleLaunchError(error) {
    console.error("Error launching the app:", error);
    console.log("Checking app container...");
    try {
        await runCommand(`xcrun simctl get_app_container booted "${APP_BUNDLE_ID}"`);
    } catch (containerError) {
        console.log("App container not found");
    }
    process.exit(1);
}

async function focusSimulator() {
    console.log("Focusing on Simulator...");
    await runCommand(`osascript -e 'tell application "Simulator" to activate'`);
}

// Utility functions (kept from original file)
function getLocalIPAddress() {
    try {
        const command = `ifconfig | grep "inet " | grep -v 127.0.0.1 | head -n 1 | awk '{print $2}'`;
        return execSync(command).toString().trim();
    } catch (error) {
        console.error("Error getting local IP:", error);
        return "localhost";
    }
}

function runCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
        exec(command, { maxBuffer: 1024 * 1024 * 10, ...options }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Command failed: ${command}`);
                console.error(`Error: ${error.message}`);
                console.error(`stderr: ${stderr}`);
                reject(error);
                return;
            }
            if (stderr) {
                console.warn(`Warning: ${stderr}`);
            }
            resolve(stdout.trim());
        });
    });
}

async function getBootedSimulatorUUID(modelName) {
    try {
        // First try to find a booted simulator of the specified model
        let command = `xcrun simctl list devices | grep "${modelName}" | grep "Booted" | grep -E -o -i "([0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12})" | head -n 1`;
        let uuid = execSync(command).toString().trim();
        
        if (uuid) {
            console.log(`Found booted simulator of model ${modelName}`);
            return uuid;
        }
        
        // If no booted simulator of the specified model is found, check any booted simulator
        console.log(`No booted simulator of model ${modelName} found, checking for any booted simulator...`);
        command = `xcrun simctl list devices | grep "Booted" | grep -E -o -i "([0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12})" | head -n 1`;
        uuid = execSync(command).toString().trim();
        
        if (uuid) {
            console.log('Found another booted simulator, will use it instead');
            return uuid;
        }
        
        return null;
    } catch (error) {
        console.log('No booted simulators found');
        return null;
    }
}

async function buildProject(scheme, sdk, destination, bundleId, derivedDataPath, projectName) {
    const buildCommand = `xcodebuild \
        -scheme "${scheme}" \
        -sdk ${sdk} \
        -configuration Debug \
        -destination "${destination}" \
        PRODUCT_BUNDLE_IDENTIFIER="${bundleId}" \
        DEVELOPMENT_TEAM="" \
        CODE_SIGN_IDENTITY="" \
        CODE_SIGNING_REQUIRED=NO \
        CODE_SIGNING_ALLOWED=NO \
        ONLY_ACTIVE_ARCH=YES \
        BUILD_DIR="${derivedDataPath}/${projectName}-Build/Build/Products" \
        CONFIGURATION_BUILD_DIR="${derivedDataPath}/${projectName}-Build/Build/Products/Debug-iphonesimulator" \
        build`;

    return runCommand(buildCommand, { maxBuffer: 1024 * 1024 * 10 });
}

async function main() {
    try {
        const originalDir = process.cwd();
        console.log('Starting build process from:', originalDir);
        
        await generateConfigConstants();
        console.log('Changing directory to:', PROJECT_DIR);
        process.chdir(PROJECT_DIR);
        
        await cleanBuildArtifacts();
        await buildXcodeProject();
        
        // Get absolute path before any directory changes
        const APP_PATH = await findAppPath();
        console.log('Found app at:', APP_PATH);
        
        await setupSimulator();
        await installAndLaunchApp(APP_PATH);
        
        // Return to original directory
        process.chdir(originalDir);
    } catch (error) {
        console.error("An error occurred:", error);
        console.error(error.stack);
    }
}

main();