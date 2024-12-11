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

const ANDROID_SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!ANDROID_SDK) {
    throw new Error('ANDROID_HOME or ANDROID_SDK_ROOT environment variable must be set');
}

const EMULATOR_PATH = `${ANDROID_SDK}/emulator/emulator`;

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

async function installApp() {
    try {
        console.log('Building and installing app...');
        const buildCommand = `cd ./androidProject && ./gradlew generateWebViewConfig -PconfigPath=${configPath} && ./gradlew clean installDebug && adb shell monkey -p ${androidConfig.packageName} 1`;
        
        await runInteractiveCommand('sh', ['-c', buildCommand], {
            'BUILD SUCCESSFUL': ''
        });
        
        console.log('Installation completed successfully!');
    } catch (error) {
        console.error('Error installing app:', error);
        throw error;
    }
}

async function main() {
    try {
        const emulatorRunning = await checkEmulator();
        
        if (!emulatorRunning) {
            console.log('No emulator running, attempting to start one...');
            await startEmulator();
        } else {
            console.log('Emulator already running, proceeding with installation...');
        }
        
        await installApp();
    } catch (error) {
        console.error('Error in main process:', error);
        process.exit(1);
    }
}

main();