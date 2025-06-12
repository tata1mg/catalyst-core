"use strict";

var _child_process = require("child_process");
var _fs = _interopRequireDefault(require("fs"));
var _path = _interopRequireDefault(require("path"));
var _utils = require("./utils.js");
var _TerminalProgress = _interopRequireDefault(require("./TerminalProgress.js"));

// Import the AAB builder
import { buildAndroidAAB } from './renameAndroidProject.js';

function _interopRequireDefault(e) {
    return e && e.__esModule ? e : { default: e };
}

const configPath = `${process.env.PWD}/config/config.json`;
const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`;
const ANDROID_PACKAGE = "com.example.androidProject";

const steps = {
    config: 'Initialize Configuration',
    tools: 'Validate Android Tools',
    emulator: 'Check and Start Emulator',
    copyAssets: 'Copy Build Assets',
    build: 'Build and Install Application',
    aab: 'Build Signed AAB'
};

const progressConfig = {
    titlePaddingTop: 2,
    titlePaddingBottom: 1,
    stepPaddingLeft: 4,
    stepSpacing: 1,
    errorPaddingLeft: 6,
    bottomMargin: 2
};

const progress = new _TerminalProgress.default(steps, "Catalyst Android Build", progressConfig);

async function initializeConfig() {
    const configFile = _fs.default.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFile);
    const { WEBVIEW_CONFIG } = config;

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        throw new Error('WebView Config missing in ' + configPath);
    }

    if (!WEBVIEW_CONFIG.android) {
        throw new Error('Android config missing in WebView Config');
    }

    // Log build type information
    const buildType = WEBVIEW_CONFIG.android.buildType || 'debug';
    progress.log(`Build Type: ${buildType}`, 'info');
    
    if (buildType === 'release') {
        progress.log('Release build detected - AAB will be generated', 'info');
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

    if (!_fs.default.existsSync(ANDROID_SDK)) {
        throw new Error(`Android SDK path does not exist: ${ANDROID_SDK}`);
    }

    if (!_fs.default.existsSync(ADB_PATH)) {
        throw new Error(`ADB not found at: ${ADB_PATH}`);
    }

    try {
        (0, _utils.runCommand)(`${ADB_PATH} version`);
        progress.log('ADB validation successful', 'success');
    } catch (error) {
        throw new Error(`ADB is not working properly: ${error.message}`);
    }

    // Skip emulator validation for release builds
    const buildType = androidConfig.buildType || 'debug';
    if (buildType !== 'release') {
        if (!_fs.default.existsSync(EMULATOR_PATH)) {
            throw new Error(`Emulator not found at: ${EMULATOR_PATH}`);
        }

        try {
            (0, _utils.runCommand)(`${EMULATOR_PATH} -version`);
            progress.log('Emulator validation successful', 'success');
        } catch (error) {
            throw new Error(`Emulator is not working properly: ${error.message}`);
        }

        try {
            const avdOutput = (0, _utils.runCommand)(`${EMULATOR_PATH} -list-avds`);
            if (!avdOutput.includes(androidConfig.emulatorName)) {
                throw new Error(`Specified emulator "${androidConfig.emulatorName}" not found in available AVDs`);
            }
            progress.log(`Emulator "${androidConfig.emulatorName}" exists`, 'success');
        } catch (error) {
            throw new Error(`Error checking emulator AVD: ${error.message}`);
        }
    } else {
        progress.log('Skipping emulator validation for release build', 'info');
    }

    progress.log('Android tools validation completed successfully!', 'success');
    return { ANDROID_SDK, ADB_PATH, EMULATOR_PATH };
}

async function checkEmulator(ADB_PATH) {
    try {
        const devices = (0, _utils.runCommand)(`${ADB_PATH} devices`);
        return devices.includes('emulator');
    } catch (error) {
        progress.log('Error checking emulator status: ' + error.message, 'error');
        return false;
    }
}

async function startEmulator(EMULATOR_PATH, androidConfig) {
    progress.log(`Starting emulator: ${androidConfig.emulatorName}...`, 'info');
    return new Promise((resolve, reject) => {
        (0, _child_process.exec)(`${EMULATOR_PATH} -avd ${androidConfig.emulatorName} -read-only > /dev/null &`, (error, stdout, stderr) => {
            if (error) {
                progress.log('Error starting emulator: ' + error.message, 'error');
                reject(error);
            } else {
                progress.log('Emulator started successfully', 'success');
                resolve();
            }
        });
    });
}

async function copyBuildAssets(androidConfig, buildOptimisation = false) {
    if (!buildOptimisation) return;

    progress.log('Copying build assets to Android project...', 'info');
    try {
        // Define source and destination paths
        const sourcePath = `${process.env.PWD}/build/`;
        const destPath = `${pwd}/androidProject/app/src/main/assets/build/`;

        // Create destination directory if it doesn't exist
        (0, _utils.runCommand)(`mkdir -p ${destPath}`);

        // Clear existing destination to avoid conflicts
        (0, _utils.runCommand)(`rm -rf ${destPath}/*`);

        // Files to exclude from copying
        const excludePatterns = ['route-manifest.json.gz', 'route-manifest.json.br'];

        if (buildOptimisation) {
            progress.log('Running with build optimization...', 'info');
            const excludeParams = excludePatterns.map(pattern => `--exclude="${pattern}"`).join(' ');
            const rsyncCommand = `rsync -av ${excludeParams} ${sourcePath} ${destPath}`;
            progress.log('Executing rsync command with exclusions...', 'info');
            (0, _utils.runCommand)(rsyncCommand);

            // Verify excluded files don't exist in destination
            for (const pattern of excludePatterns) {
                const checkCommand = `find ${destPath} -name "${pattern}" | wc -l`;
                const count = parseInt((0, _utils.runCommand)(checkCommand).trim(), 10);
                if (count > 0) {
                    progress.log(`Warning: Found ${count} instances of excluded file ${pattern}`, 'warning');
                    (0, _utils.runCommand)(`find ${destPath} -name "${pattern}" -delete`);
                }
            }
            progress.log('Build assets copied with optimization (excluded route-manifest JSON files)', 'success');
        } else {
            progress.log('Running without build optimization...', 'info');
            const exclusions = excludePatterns.map(pattern => `-not -name "${pattern}"`).join(' ');
            const copyCommand = `find ${sourcePath} -type f ${exclusions} -exec cp --parents {} ${destPath} \\;`;
            progress.log(`Executing copy command with exclusions...`, 'info');
            (0, _utils.runCommand)(copyCommand);
            progress.log('Build assets copied successfully!', 'success');
        }
    } catch (error) {
        throw new Error('Error copying build assets: ' + error.message);
    }
}

async function installApp(ADB_PATH, androidConfig, buildOptimisation) {
    progress.log('Building and installing app...', 'info');
    try {
        const buildCommand = `cd ${pwd}/androidProject && ./gradlew generateWebViewConfig -PconfigPath=${configPath} -PbuildOptimisation=${buildOptimisation} && ./gradlew clean installDebug && ${ADB_PATH} shell monkey -p ${ANDROID_PACKAGE} 1`;
        await (0, _utils.runInteractiveCommand)('sh', ['-c', buildCommand], { 'BUILD SUCCESSFUL': '' });
        progress.log('Installation completed successfully!', 'success');
    } catch (error) {
        throw new Error('Error installing app: ' + error.message);
    }
}

async function createAABConfig(androidConfig) {
    // Create AAB configuration based on WebView config
    const aabConfig = {
        android: {
            oldProjectName: "androidProject", // Default project name in catalyst
            newProjectName: androidConfig.appName || androidConfig.packageName?.split('.').pop() || "catalystapp",
            projectPath: `${pwd}/androidProject`,
            createSignedAAB: true,
            outputPath: androidConfig.outputPath || `${process.env.PWD}/build-output`,
            overwriteExisting: true
        }
    };

    // Add keystore configuration if available
    if (androidConfig.keystoreConfig) {
        aabConfig.android.keystoreConfig = androidConfig.keystoreConfig;
    } else if (androidConfig.keystore) {
        // Map old keystore format to new format
        aabConfig.android.keystoreConfig = {
            keyAlias: androidConfig.keystore.alias || "release",
            storePassword: androidConfig.keystore.storePassword,
            keyPassword: androidConfig.keystore.keyPassword,
            validityYears: 25,
            organizationInfo: {
                companyName: androidConfig.keystore.organizationName || "YourCompany",
                city: androidConfig.keystore.city || "YourCity",
                state: androidConfig.keystore.state || "YourState",
                countryCode: androidConfig.keystore.countryCode || "US"
            }
        };
    }

    // Write temporary config file for AAB builder
    const tempConfigPath = `${process.env.PWD}/temp-aab-config.json`;
    _fs.default.writeFileSync(tempConfigPath, JSON.stringify(aabConfig, null, 2));
    
    return tempConfigPath;
}

async function buildSignedAAB(androidConfig) {
    progress.log('Building signed AAB for release...', 'info');
    
    try {
        // Create AAB configuration
        const tempConfigPath = await createAABConfig(androidConfig);
        
        // Call the AAB builder
        await buildAndroidAAB(tempConfigPath);
        
        // Clean up temporary config
        if (_fs.default.existsSync(tempConfigPath)) {
            _fs.default.unlinkSync(tempConfigPath);
        }
        
        progress.log('Signed AAB build completed successfully!', 'success');
    } catch (error) {
        throw new Error('Error building signed AAB: ' + error.message);
    }
}

async function buildAndroidApp() {
    // Initialize androidConfig outside try block to ensure it's available in catch
    let androidConfig = null;
    
    try {
        // Initialize configuration
        progress.start('config');
        const { WEBVIEW_CONFIG } = await initializeConfig();
        androidConfig = WEBVIEW_CONFIG.android;
        const buildType = androidConfig.buildType || 'debug';
        const buildOptimisation = !!androidConfig.buildOptimisation || false;
        progress.complete('config');

        // Validate tools and get paths
        progress.start('tools');
        const { ANDROID_SDK, ADB_PATH, EMULATOR_PATH } = await validateAndroidTools(androidConfig);
        progress.complete('tools');

        // Handle emulator for debug builds only
        if (buildType !== 'release') {
            progress.start('emulator');
            const emulatorRunning = await checkEmulator(ADB_PATH);
            if (!emulatorRunning) {
                progress.log('No emulator running, attempting to start one...', 'info');
                await startEmulator(EMULATOR_PATH, androidConfig);
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                progress.log('Emulator already running', 'success');
            }
            progress.complete('emulator');
        } else {
            progress.log('Skipping emulator setup for release build', 'info');
        }

        // Copy build assets
        progress.start('copyAssets');
        await copyBuildAssets(androidConfig, buildOptimisation);
        progress.log(`Build optimization: ${buildOptimisation ? 'Enabled' : 'Disabled'}`, 'info');
        progress.complete('copyAssets');

        // Build based on type
        if (buildType === 'release') {
            // Build signed AAB for release
            progress.start('aab');
            await buildSignedAAB(androidConfig);
            progress.complete('aab');
        } else {
            // Install debug app for development
            progress.start('build');
            await installApp(ADB_PATH, androidConfig, buildOptimisation);
            progress.complete('build');
        }

        // Print build summary
        const summaryItems = [
            'Build completed successfully:',
            { text: `Build Type: ${buildType}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `SDK Path: ${androidConfig.sdkPath}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `Build Optimization: ${buildOptimisation ? 'Enabled' : 'Disabled'}`, indent: 1, prefix: '├─ ', color: 'gray' }
        ];

        if (buildType === 'release') {
            summaryItems.push({ 
                text: `Output: Signed AAB generated in build-output/`, 
                indent: 1, 
                prefix: '└─ ', 
                color: 'green' 
            });
        } else {
            summaryItems.push({ 
                text: `Emulator: ${androidConfig.emulatorName}`, 
                indent: 1, 
                prefix: '└─ ', 
                color: 'gray' 
            });
        }

        progress.printTreeContent('Build Summary', summaryItems);
        process.exit(0);

    } catch (error) {
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, error.message);
            
            const troubleshootingItems = [
                'Build failed. Please try the following steps:',
                { text: 'Check if Android SDK is properly configured', indent: 1, prefix: '├─ ', color: 'yellow' },
                { text: 'Verify build assets exist in the source directory', indent: 1, prefix: '├─ ', color: 'yellow' }
            ];

            // Use androidConfig safely with null checks
            const buildType = androidConfig?.buildType || 'debug';
            if (buildType === 'release') {
                troubleshootingItems.push(
                    { text: 'Verify keystore configuration for release builds', indent: 1, prefix: '├─ ', color: 'yellow' },
                    { text: 'Check that keystore passwords are properly set', indent: 1, prefix: '├─ ', color: 'yellow' }
                );
            } else {
                troubleshootingItems.push(
                    { text: 'Verify that the emulator exists and is working', indent: 1, prefix: '├─ ', color: 'yellow' }
                );
            }

            troubleshootingItems.push(
                { text: 'Run "npm run setupEmulator:android" to reconfigure Android settings', indent: 1, prefix: '└─ ', color: 'yellow' },
                '\nVerify Configuration:'
            );

            // Add configuration details only if androidConfig is available
            if (androidConfig) {
                troubleshootingItems.push(
                    { text: `Build Type: ${buildType}`, indent: 1, prefix: '├─ ', color: 'gray' },
                    { text: `Android SDK Path: ${androidConfig.sdkPath || 'Not configured'}`, indent: 1, prefix: '├─ ', color: 'gray' }
                );

                if (buildType !== 'release') {
                    troubleshootingItems.push({
                        text: `Selected Emulator: ${androidConfig.emulatorName || 'Not configured'}`,
                        indent: 1,
                        prefix: '└─ ',
                        color: 'gray'
                    });
                } else {
                    troubleshootingItems.push({
                        text: `Output Path: ${androidConfig.outputPath || 'build-output/'}`,
                        indent: 1,
                        prefix: '└─ ',
                        color: 'gray'
                    });
                }
            } else {
                troubleshootingItems.push(
                    { text: 'Configuration could not be loaded', indent: 1, prefix: '├─ ', color: 'red' },
                    { text: 'Check if config/config.json exists and has valid Android configuration', indent: 1, prefix: '└─ ', color: 'red' }
                );
            }

            progress.printTreeContent('Troubleshooting Guide', troubleshootingItems);
        }
        process.exit(1);
    }
}

// Execute the main build process
buildAndroidApp();