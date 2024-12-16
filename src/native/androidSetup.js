const {
    runCommand,
    runInteractiveCommand
} = require('./utils');

const { exec } = require('child_process');
const configPath = `${process.env.PWD}/config/config.json`

const { WEBVIEW_CONFIG } = require(configPath)
if (Object.length(WEBVIEW_CONFIG) === 0){
    console.error('WebView Config missing in ', configPath);
    process.exit(1);
}
    

const androidConfig = WEBVIEW_CONFIG.android;

const ANDROID_SDK = androidConfig.sdkPath;
if (!ANDROID_SDK) {
    throw new Error('ANDROID_HOME or ANDROID_SDK_ROOT environment variable must be set');
}

const EMULATOR_PATH = `${ANDROID_SDK}/emulator/emulator`;

function validateAndroidTools() {
    console.log('Validating Android tools...');
    
    // Check if SDK path exists
    if (!fs.existsSync(ANDROID_SDK)) {
        throw new Error(`Android SDK path does not exist: ${ANDROID_SDK}`);
    }

    // Check ADB
    if (!fs.existsSync(ADB_PATH)) {
        throw new Error(`ADB not found at: ${ADB_PATH}`);
    }
    try {
        runCommand(`${ADB_PATH} version`);
        console.log('✓ ADB is valid');
    } catch (error) {
        throw new Error(`ADB is not working properly: ${error.message}`);
    }

    // Check Emulator
    if (!fs.existsSync(EMULATOR_PATH)) {
        throw new Error(`Emulator not found at: ${EMULATOR_PATH}`);
    }
    try {
        runCommand(`${EMULATOR_PATH} -version`);
        console.log('✓ Emulator is valid');
    } catch (error) {
        throw new Error(`Emulator is not working properly: ${error.message}`);
    }

    // Check if the specified emulator exists
    try {
        const avdOutput = runCommand(`${EMULATOR_PATH} -list-avds`);
        if (!avdOutput.includes(androidConfig.emulatorName)) {
            throw new Error(`Specified emulator "${androidConfig.emulatorName}" not found in available AVDs`);
        }
        console.log(`✓ Emulator "${androidConfig.emulatorName}" exists`);
    } catch (error) {
        throw new Error(`Error checking emulator AVD: ${error.message}`);
    }

    console.log('Android tools validation completed successfully!');
}

async function checkEmulator() {
    try {
        const devices = runCommand('adb devices');
        return devices.includes('emulator');
    } catch (error) {
        console.error('Error checking emulator:', error);
        return false;
    }
}

async function startEmulator() {

        console.log(`Starting emulator: ${androidConfig.emulatorName}...`);
        exec(`${ANDROID_SDK}/emulator/emulator -avd ${androidConfig.emulatorName} -read-only > /dev/null &`, 
            (error, stdout, stderr) => {
                if (error) {
                    console.error('Error starting emulator:', error);
                }
            }
        );
    
}
async function main() {
    try {
        // Validate Android tools before proceeding
        validateAndroidTools();

        const emulatorRunning = await checkEmulator();
        
        if (!emulatorRunning) {
            console.log('No emulator running, attempting to start one...');
            await startEmulator();
        } else {
            console.log('Emulator already running, proceeding with installation...');
        }
        
    } catch (error) {
        console.error('Error in main process:', error);
        process.exit(1);
    }
}

main();