import fs from 'fs';
import { exec } from 'child_process';
import { runCommand, promptUser, validateAndCompleteConfig } from './utils.js';
import TerminalProgress from './TerminalProgress.js';

const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`;
const configPath = `${process.env.PWD}/config/config.json`;

const steps = {
    java: 'Check Java Environment',
    config: 'Initialize Configuration',
    androidTools: 'Validate Android Tools',
    emulator: 'Configure Android Emulator',
    properties: 'Update Local Properties',
    saveConfig: 'Save Configuration'
};

const progressPaddingConfig = {
    titlePaddingTop: 2,
    titlePaddingBottom: 1,
    stepPaddingLeft: 4,
    stepSpacing: 1,
    errorPaddingLeft: 6,
    bottomMargin: 2
};

const progress = new TerminalProgress(steps, "Catalyst Universal Android Setup", progressPaddingConfig);

async function checkJavaInstallation() {
    try {
        runCommand('java -version');
        runCommand('javac -version');
        progress.log('Java is installed and configured', 'success');
        return true;
    } catch (error) {
        progress.log('Java installation not found or not properly configured', 'error');
        return false;
    }
}

async function installJava() {
    progress.log('Installing Java (Zulu JDK 17)...');
    try {
        try {
            runCommand('brew --version');
        } catch (error) {
            throw new Error('Homebrew is required but not installed. Please install Homebrew first.');
        }

        await runCommand('brew install --cask zulu@17');
        const javaHome = '/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home';
        const homeDir = process.env.HOME;
        const shellProfile = `${homeDir}/.zshrc`;
        
        const exportCommand = `\n# Java Configuration\nexport JAVA_HOME=${javaHome}\nexport PATH=$JAVA_HOME/bin:$PATH\n`;
        fs.appendFileSync(shellProfile, exportCommand);
        
        process.env.JAVA_HOME = javaHome;
        process.env.PATH = `${javaHome}/bin:${process.env.PATH}`;
        
        progress.log('Java installed and configured successfully', 'success');
        progress.log(`NOTE: Please restart your terminal or run: source ${shellProfile}`, 'info');
        
        const javaVersion = runCommand('java -version');
        progress.log(`Java installation verified: ${javaVersion}`, 'success');
        
        return true;
    } catch (error) {
        progress.log(`Failed to install Java: ${error.message}`, 'error');
        return false;
    }
}

async function validateJavaEnvironment() {
    progress.start('java');
    const hasJava = await checkJavaInstallation();
    
    if (!hasJava) {
        progress.log('Java installation required. Starting installation process...');
        const javaInstalled = await installJava();
        if (!javaInstalled) {
            progress.fail('java', 'Failed to set up Java environment');
            throw new Error('Failed to set up Java environment');
        }
    }
    progress.complete('java');
}

async function initializeConfig() {
    const configFile = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFile);
    const { WEBVIEW_CONFIG } = config;

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        progress.log('WebView Config missing in ' + configPath, 'error');
        process.exit(1);
    }

    if (!WEBVIEW_CONFIG.android) {
        WEBVIEW_CONFIG.android = {};
    }

    return { WEBVIEW_CONFIG };
}

async function saveConfig(newConfig) {
    try {
        const existingConfigFile = fs.readFileSync(configPath, 'utf8');
        const existingConfig = JSON.parse(existingConfigFile);
        
        const updatedConfig = {
            ...existingConfig,
            WEBVIEW_CONFIG: newConfig.WEBVIEW_CONFIG
        };
        
        fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
        progress.log('Configuration saved successfully', 'success');
    } catch (error) {
        progress.log('Failed to save configuration: ' + error.message, 'error');
        process.exit(1);
    }
}

function validateAndroidTools(androidConfig) {
    const ANDROID_SDK = androidConfig.sdkPath;
    const EMULATOR_PATH = `${ANDROID_SDK}/emulator/emulator`;
    const ADB_PATH = `${ANDROID_SDK}/platform-tools/adb`;
    
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
        progress.log('ADB is valid', 'success');
    } catch (error) {
        throw new Error(`ADB is not working properly: ${error.message}`);
    }

    if (!fs.existsSync(EMULATOR_PATH)) {
        throw new Error(`Emulator not found at: ${EMULATOR_PATH}`);
    }

    try {
        runCommand(`${EMULATOR_PATH} -version`);
        progress.log('Emulator is valid', 'success');
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
    return { EMULATOR_PATH, ADB_PATH };
}

async function checkEmulator(ADB_PATH) {
    try {
        const devices = runCommand(`${ADB_PATH} devices`);
        return devices.includes('emulator');
    } catch (error) {
        progress.log(`Error checking emulator: ${error}`, 'error');
        return false;
    }
}

async function startEmulator(EMULATOR_PATH, androidConfig) {
    progress.log(`Starting emulator: ${androidConfig.emulatorName}...`);
    exec(`${EMULATOR_PATH} -avd ${androidConfig.emulatorName} -read-only > /dev/null &`, 
        (error, stdout, stderr) => {
            if (error) {
                progress.log(`Error starting emulator: ${error}`, 'error');
            }
        }
    );
}

async function updateLocalProperties(sdkPath) {
    progress.start('properties');
    try {
        runCommand(`cd ${pwd}/androidProject && ./gradlew updateSdkPath -PsdkPath="${sdkPath}"`);
        progress.log('Updated local.properties successfully', 'success');
        progress.complete('properties');
    } catch (error) {
        progress.fail('properties', `Failed to update local.properties: ${error.message}`);
        throw error;
    }
}

async function setupAndroidEnvironment() {
    try {
        await validateJavaEnvironment();

        progress.start('config');
        const { WEBVIEW_CONFIG } = await initializeConfig();
        const config = await validateAndCompleteConfig('android', configPath);
        progress.complete('config');
        
        progress.start('androidTools');
        const { EMULATOR_PATH, ADB_PATH } = validateAndroidTools(config.android);
        progress.complete('androidTools');

        progress.start('emulator');
        const emulatorRunning = await checkEmulator(ADB_PATH);
        if (!emulatorRunning) {
            progress.log('No emulator running, attempting to start one...');
            await startEmulator(EMULATOR_PATH, config.android);
        } else {
            progress.log('Emulator already running, proceeding with installation...', 'success');
        }
        progress.complete('emulator');

        if (config.android?.sdkPath) {
            await updateLocalProperties(config.android.sdkPath);
        }

        progress.start('saveConfig');
        await saveConfig({ WEBVIEW_CONFIG: config });
        progress.complete('saveConfig');

        progress.printTreeContent('Configuration Explanation', [
            'WEBVIEW_CONFIG: Main configuration object for the WebView setup',
            { text: 'port: Port number for the WebView server', indent: 1, prefix: '├─ ', color: 'gray' },
            { text: 'android: Android-specific configuration', indent: 1, prefix: '└─ ', color: 'gray' },
            { text: 'buildType: Build type (debug/release)', indent: 2, prefix: '├─ ', color: 'gray' },
            { text: 'sdkPath: Android SDK path', indent: 2, prefix: '├─ ', color: 'gray' },
            { text: 'emulatorName: Selected Android emulator name', indent: 2, prefix: '└─ ', color: 'gray' }
        ]);

        progress.printTreeContent('Final Configuration', [
            JSON.stringify(config, null, 2)
        ]);
        
        process.exit(0);
    } catch (error) {
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, error.message);
        }
        process.exit(1);
    }
}

// Execute the main setup
setupAndroidEnvironment();