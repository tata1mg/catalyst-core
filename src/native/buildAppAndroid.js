import { exec } from 'child_process';
import fs from 'fs';
import { runCommand, runInteractiveCommand } from './utils.js';

const configPath = `${process.env.PWD}/config/config.json`;
const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`;
const ANDROID_PACKAGE = "com.example.androidProject"

async function initializeConfig() {
    const configFile = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFile);
    const { WEBVIEW_CONFIG } = config;

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        console.error('WebView Config missing in', configPath);
        process.exit(1);
    }

    if (!WEBVIEW_CONFIG.android) {
        console.error('Android config missing in WebView Config');
        process.exit(1);
    }
    return { WEBVIEW_CONFIG };
}

function validateAndroidTools(androidConfig) {
    const ANDROID_SDK = androidConfig.sdkPath;
    const ADB_PATH = `${ANDROID_SDK}/platform-tools/adb`;
    const EMULATOR_PATH = `${ANDROID_SDK}/emulator/emulator`;

    console.log('Validating Android tools...');
    
    if (!ANDROID_SDK) {
        throw new Error('Android SDK path is not configured');
    }

    if (!fs.existsSync(ANDROID_SDK)) {
        throw new Error(`Android SDK path does not exist: ${ANDROID_SDK}`);
    }

    if (!fs.existsSync(ADB_PATH)) {
        throw new Error(`ADB not found at: ${ADB_PATH}`);
    }

    try {
        runCommand(`${ADB_PATH} version`);
        console.log('✓ ADB is valid');
    } catch (error) {
        throw new Error(`ADB is not working properly: ${error.message}`);
    }

    if (!fs.existsSync(EMULATOR_PATH)) {
        throw new Error(`Emulator not found at: ${EMULATOR_PATH}`);
    }

    try {
        runCommand(`${EMULATOR_PATH} -version`);
        console.log('✓ Emulator is valid');
    } catch (error) {
        throw new Error(`Emulator is not working properly: ${error.message}`);
    }

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
    return { ANDROID_SDK, ADB_PATH, EMULATOR_PATH };
}

async function checkEmulator(ADB_PATH) {
    try {
        const devices = runCommand(`${ADB_PATH} devices`);
        return devices.includes('emulator');
    } catch (error) {
        console.error('Error checking emulator:', error);
        return false;
    }
}

async function startEmulator(EMULATOR_PATH, androidConfig) {
    console.log(`Starting emulator: ${androidConfig.emulatorName}...`);
    exec(`${EMULATOR_PATH} -avd ${androidConfig.emulatorName} -read-only > /dev/null &`, 
        (error, stdout, stderr) => {
            if (error) {
                console.error('Error starting emulator:', error);
            }
        }
    );
}

async function installApp(ADB_PATH, androidConfig) {
    try {
        console.log('Building and installing app...');
        const buildCommand = `cd ${pwd}/androidProject && ./gradlew generateWebViewConfig -PconfigPath=${configPath} && ./gradlew clean installDebug && ${ADB_PATH} shell monkey -p ${ANDROID_PACKAGE} 1`;
        
        await runInteractiveCommand('sh', ['-c', buildCommand], {
            'BUILD SUCCESSFUL': ''
        });
        
        console.log('Installation completed successfully!');
    } catch (error) {
        console.error('Error installing app:', error);
        throw error;
    }
}

async function buildAndroidApp() {
    try {
        // Initialize configuration
        const { WEBVIEW_CONFIG } = await initializeConfig();
        const androidConfig = WEBVIEW_CONFIG.android;

        // Validate tools and get paths
        const { ANDROID_SDK, ADB_PATH, EMULATOR_PATH } = validateAndroidTools(androidConfig);

        // Check and start emulator if needed
        const emulatorRunning = await checkEmulator(ADB_PATH);
        if (!emulatorRunning) {
            console.log('No emulator running, attempting to start one...');
            await startEmulator(EMULATOR_PATH, androidConfig);
        } else {
            console.log('Emulator already running, proceeding with installation...');
        }
        
        // Install the app
        await installApp(ADB_PATH, androidConfig);
        process.exit(0);
        
    } catch (error) {
        console.error('Error in build process:', error);
        process.exit(1);
    }
}

// Execute the main build process
buildAndroidApp();