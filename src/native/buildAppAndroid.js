import { exec } from 'child_process';
import fs from 'fs';
import { runCommand, runInteractiveCommand } from './utils.js';
import TerminalProgress from './TerminalProgress.js';

const configPath = `${process.env.PWD}/config/config.json`;
const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`;
const ANDROID_PACKAGE = "com.example.androidProject";

const steps = {
    config: 'Initialize Configuration',
    tools: 'Validate Android Tools',
    emulator: 'Check and Start Emulator',
    copyAssets: 'Copy Build Assets',
    build: 'Build and Install Application'
};

const progressConfig = {
    titlePaddingTop: 2,
    titlePaddingBottom: 1,
    stepPaddingLeft: 4,
    stepSpacing: 1,
    errorPaddingLeft: 6,
    bottomMargin: 2
};

const progress = new TerminalProgress(steps, "Catalyst Android Build", progressConfig);

async function initializeConfig() {
    const configFile = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFile);
    const { WEBVIEW_CONFIG } = config;

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        throw new Error('WebView Config missing in ' + configPath);
    }

    if (!WEBVIEW_CONFIG.android) {
        throw new Error('Android config missing in WebView Config');
    }
    
    return { WEBVIEW_CONFIG };
}

function validateAndroidTools(androidConfig) {
    const ANDROID_SDK = androidConfig.sdkPath;
    const ADB_PATH = `${ANDROID_SDK}/platform-tools/adb`;
    const EMULATOR_PATH = `${ANDROID_SDK}/emulator/emulator`;

    progress.log('Validating Android tools...', 'info');
    
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
        progress.log('ADB validation successful', 'success');
    } catch (error) {
        throw new Error(`ADB is not working properly: ${error.message}`);
    }

    if (!fs.existsSync(EMULATOR_PATH)) {
        throw new Error(`Emulator not found at: ${EMULATOR_PATH}`);
    }

    try {
        runCommand(`${EMULATOR_PATH} -version`);
        progress.log('Emulator validation successful', 'success');
    } catch (error) {
        throw new Error(`Emulator is not working properly: ${error.message}`);
    }

    try {
        const avdOutput = runCommand(`${EMULATOR_PATH} -list-avds`);
        if (!avdOutput.includes(androidConfig.emulatorName)) {
            throw new Error(`Specified emulator "${androidConfig.emulatorName}" not found in available AVDs`);
        }
        progress.log(`Emulator "${androidConfig.emulatorName}" exists`, 'success');
    } catch (error) {
        throw new Error(`Error checking emulator AVD: ${error.message}`);
    }

    progress.log('Android tools validation completed successfully!', 'success');
    return { ANDROID_SDK, ADB_PATH, EMULATOR_PATH };
}

async function checkEmulator(ADB_PATH) {
    try {
        const devices = runCommand(`${ADB_PATH} devices`);
        return devices.includes('emulator');
    } catch (error) {
        progress.log('Error checking emulator status: ' + error.message, 'error');
        return false;
    }
}

async function startEmulator(EMULATOR_PATH, androidConfig) {
    progress.log(`Starting emulator: ${androidConfig.emulatorName}...`, 'info');
    return new Promise((resolve, reject) => {
        exec(`${EMULATOR_PATH} -avd ${androidConfig.emulatorName} -read-only > /dev/null &`, 
            (error, stdout, stderr) => {
                if (error) {
                    progress.log('Error starting emulator: ' + error.message, 'error');
                    reject(error);
                } else {
                    progress.log('Emulator started successfully', 'success');
                    resolve();
                }
            }
        );
    });
}

async function copyBuildAssets(androidConfig, buildOptimisation = false) {
    progress.log('Copying build assets to Android project...', 'info');
    
    try {
        // Define source and destination paths
        const sourcePath = `${process.env.PWD}/build/`;
        const destPath = `${pwd}/androidProject/app/src/main/assets/build/`;
        
        // Files to exclude from copying
        const excludePatterns = [
            '**/route-manifest.json.gz',
            '**/route-manifest.json.br'
        ];
        
        // Create exclusion parameters for the find command
        const exclusions = excludePatterns
            .map(pattern => `-not -path "${pattern}"`)
            .join(' ');
        
        // Determine the copy command based on the buildOptimisation flag
        let copyCommand;
        
        if (buildOptimisation) {
            progress.log('Running with build optimization...', 'info');
            // We need to use find to exclude specific files
            // First, ensure the destination directory exists
            runCommand(`mkdir -p ${destPath}`);
            // Then use find to copy files while excluding specific patterns
            copyCommand = `find ${sourcePath} -type f ${exclusions} -exec cp --parents {} ${destPath} \\;`;
        
        
            progress.log(`Executing copy command with exclusions...`, 'info');
            runCommand(copyCommand);
            progress.log('Build assets copied successfully!', 'success');
        }
        
    } catch (error) {
        throw new Error('Error copying build assets: ' + error.message);
    }
}

async function installApp(ADB_PATH, androidConfig) {
    progress.log('Building and installing app...', 'info');
    try {
        const buildCommand = `cd ${pwd}/androidProject && ./gradlew generateWebViewConfig -PconfigPath=${configPath} && ./gradlew clean installDebug && ${ADB_PATH} shell monkey -p ${ANDROID_PACKAGE} 1`;
        
        await runInteractiveCommand('sh', ['-c', buildCommand], {
            'BUILD SUCCESSFUL': ''
        });
        
        progress.log('Installation completed successfully!', 'success');
    } catch (error) {
        throw new Error('Error installing app: ' + error.message);
    }
}

async function buildAndroidApp() {
    try {
        // Initialize configuration
        progress.start('config');
        const { WEBVIEW_CONFIG } = await initializeConfig();
        const androidConfig = WEBVIEW_CONFIG.android;
        // Get buildOptimisation flag from WebView config
        const buildOptimisation = !!androidConfig.buildOptimisation || false;
        progress.complete('config');

        // Validate tools and get paths
        progress.start('tools');
        const { ANDROID_SDK, ADB_PATH, EMULATOR_PATH } = await validateAndroidTools(androidConfig);
        progress.complete('tools');

        // Check and start emulator if needed
        progress.start('emulator');
        const emulatorRunning = await checkEmulator(ADB_PATH);
        if (!emulatorRunning) {
            progress.log('No emulator running, attempting to start one...', 'info');
            await startEmulator(EMULATOR_PATH, androidConfig);
            // Wait for emulator to fully boot
            await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
            progress.log('Emulator already running', 'success');
        }
        progress.complete('emulator');
        
        // Copy build assets to Android project
        progress.start('copyAssets');
        await copyBuildAssets(androidConfig, buildOptimisation);
        progress.log(`Build optimization: ${buildOptimisation ? 'Enabled' : 'Disabled'}`, 'info');
        progress.complete('copyAssets');
        
        // Install the app
        progress.start('build');
        await installApp(ADB_PATH, androidConfig);
        progress.complete('build');

        // Print build summary
        progress.printTreeContent('Build Summary', [
            'Build completed successfully:',
            { text: `Emulator: ${androidConfig.emulatorName}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Build Type: ${androidConfig.buildType || 'Debug'}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `SDK Path: ${androidConfig.sdkPath}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Build Optimization: ${buildOptimisation ? 'Enabled' : 'Disabled'}`, indent: 1, prefix: '└─ ', color: 'gray' }
        ]);

        process.exit(0);
    } catch (error) {
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, error.message);
            
            if (progress.currentStep.id === 'build' || progress.currentStep.id === 'copyAssets') {
                progress.printTreeContent('Troubleshooting Guide', [
                    'Build failed. Please try the following steps:',
                    { text: 'Check if Android SDK is properly configured', indent: 1, prefix: '├─ ', color: 'yellow' },
                    { text: 'Verify that the emulator exists and is working', indent: 1, prefix: '├─ ', color: 'yellow' },
                    { text: 'Verify build assets exist in the source directory', indent: 1, prefix: '├─ ', color: 'yellow' },
                    { text: 'Run "npm run setupEmulator:android" to reconfigure Android settings', indent: 1, prefix: '└─ ', color: 'yellow' },
                    '\nVerify Configuration:',
                    { text: `Selected Emulator: ${WEBVIEW_CONFIG?.android?.emulatorName}`, indent: 1, prefix: '├─ ', color: 'gray' },
                    { text: `Android SDK Path: ${WEBVIEW_CONFIG?.android?.sdkPath}`, indent: 1, prefix: '└─ ', color: 'gray' }
                ]);
            }
        }
        process.exit(1);
    }
}

// Execute the main build process
// Execute the main build process with buildOptimisation from config
buildAndroidApp();