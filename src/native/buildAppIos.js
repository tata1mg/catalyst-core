const { exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`;
const { WEBVIEW_CONFIG } = require("/Users/mayankmahavar/test-webview/config/config.json" ||`${process.env.PWD}/config/config.json`);

function getLocalIPAddress() {
    try {
        const command = `ifconfig | grep "inet " | grep -v 127.0.0.1 | head -n 1 | awk '{print $2}'`;
        return execSync(command).toString().trim();
    } catch (error) {
        console.error("Error getting local IP:", error);
        return "localhost";
    }
}

const iosConfig = WEBVIEW_CONFIG.ios;
const url = `http://${getLocalIPAddress()}:${WEBVIEW_CONFIG.port}`;

// Set variables based on the configuration
const PROJECT_DIR = `${pwd}/iosnativeWebView`;
const SCHEME_NAME = "iosnativeWebView";
// Use a default debug bundle ID if none is provided
const APP_BUNDLE_ID = iosConfig.appBundleId || "com.debug.webview";
const PROJECT_NAME = path.basename(PROJECT_DIR);
const IPHONE_MODEL = iosConfig.simulatorName;

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
      const command = `xcrun simctl list devices | grep "${modelName}" | grep "Booted" | grep -E -o -i "([0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12})" | head -n 1`;
      const uuid = execSync(command).toString().trim();
      return uuid || null;
  } catch (error) {
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
        console.log("Generating ConfigConstants.swift...");
        const configOutputPath = path.join(
            PROJECT_DIR,
            PROJECT_NAME,
            "ConfigConstants.swift"
        );
        await runCommand(`swift ${pwd}/build.swift "${url}" "${configOutputPath}"`);

        process.chdir(PROJECT_DIR);
        
        // Clean build artifacts and DerivedData
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

        // Clean and build with more detailed flags
        console.log("Cleaning project...");
        await runCommand(
            `xcodebuild clean -scheme "${SCHEME_NAME}" -sdk iphonesimulator -configuration Debug`
        );

        console.log("Building project...");
        try {
            await buildProject(
                SCHEME_NAME,
                "iphonesimulator",
                `platform=iOS Simulator,name=${IPHONE_MODEL}`,
                APP_BUNDLE_ID,
                derivedDataPath,
                PROJECT_NAME
            );
        } catch (buildError) {
            // Check if error is due to multiple matching devices
            if (buildError.message.includes("multiple devices matched the request")) {
                console.log("Multiple matching devices found. Attempting to use booted device...");
                const bootedUUID = await getBootedSimulatorUUID(IPHONE_MODEL);
                
                if (bootedUUID) {
                    console.log(`Found booted simulator with UUID: ${bootedUUID}`);
                    // Retry build with specific UUID
                    await buildProject(
                        SCHEME_NAME,
                        "iphonesimulator",
                        `platform=iOS Simulator,id=${bootedUUID}`,
                        APP_BUNDLE_ID,
                        derivedDataPath,
                        PROJECT_NAME
                    );
                } else {
                    console.error("No booted simulator found. Please start a simulator and try again.");
                    process.exit(1);
                }
            } else {
                // If it's a different error, throw it
                throw buildError;
            }
        }


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

    console.log(`App found at: ${APP_PATH}`);

    console.log(`Checking for ${IPHONE_MODEL} simulator...`);
    let DEVICE_UUID = "";

    try {
      // Check for a booted device of the specified model
      DEVICE_UUID = execSync(
        `xcrun simctl list devices | grep "${IPHONE_MODEL}" | grep "(Booted)" | grep -E -o -i "([0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12})" | head -n 1`
      )
        .toString()
        .trim();
    } catch (error) {
      console.error("Error finding booted device:", error);
    }

    if (!DEVICE_UUID) {
      try {
        // If no booted device, find any available device of the specified model
        DEVICE_UUID = execSync(
          `xcrun simctl list devices | grep "${IPHONE_MODEL}" | grep -E -o -i "([0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12})" | head -n 1`
        )
          .toString()
          .trim();
      } catch (error) {
        console.error("Error finding available device:", error);
      }

      if (!DEVICE_UUID) {
        console.log(
          `No ${IPHONE_MODEL} simulator found. Please make sure it's available.`
        );
        process.exit(1);
      }

      console.log("Booting the simulator...");
      await runCommand(`xcrun simctl boot "${DEVICE_UUID}"`);

      console.log("Waiting for simulator to boot...");
      const boot_timeout = 60;
      const boot_start_time = Date.now();

      while (true) {
        const current_time = Date.now();
        const elapsed_time = Math.floor(
          (current_time - boot_start_time) / 1000
        );

        if (elapsed_time >= boot_timeout) {
          console.log(
            `Error: Simulator boot timeout after ${boot_timeout} seconds.`
          );
          process.exit(1);
        }

        const boot_status = execSync(
          `xcrun simctl list devices | grep "${DEVICE_UUID}" | awk '{print $NF}' | tr -d '()'`
        )
          .toString()
          .trim();

        if (boot_status === "Booted") {
          console.log("Simulator booted successfully.");
          break;
        }

        console.log(`Waiting for simulator to boot... (${elapsed_time}s)`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } else {
      console.log(`Using already running ${IPHONE_MODEL} simulator.`);
    }

    console.log(`Selected device UUID: ${DEVICE_UUID}`);

    console.log("Uninstalling the app if it exists...");
    await runCommand(`xcrun simctl uninstall booted "${APP_BUNDLE_ID}"`);

    console.log("Installing the app...");
    try {
      await runCommand(`xcrun simctl install booted "${APP_PATH}"`);
    } catch (error) {
      console.error("Error installing the app:", error);
      process.exit(1);
    }

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

    console.log("Launching the app...");
    try {
      await runCommand(`xcrun simctl launch booted "${APP_BUNDLE_ID}"`);
    } catch (error) {
      console.error("Error launching the app:", error);
      console.log("Checking app container...");
      try {
        await runCommand(
          `xcrun simctl get_app_container booted "${APP_BUNDLE_ID}"`
        );
      } catch (containerError) {
        console.log("App container not found");
      }
      process.exit(1);
    }

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
          console.log(
            "Warning: App launch might have failed or taken too long."
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

        console.log("Focusing on Simulator...");
        await runCommand(`osascript -e 'tell application "Simulator" to activate'`);

    // console.log("Starting debugger...");
    // await runCommand(`lldb -n "${path.basename(APP_PATH, ".app")}"`);

    // console.log("Debug session ended.");
    } catch (error) {
        console.error("An error occurred:", error);
    }
}

main();