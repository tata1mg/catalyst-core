import fs from 'fs';
import { exec } from 'child_process';
import { runCommand, promptUser, validateAndCompleteConfig } from './utils.js';

const configPath = `${process.env.PWD}/config/config.json`;

async function checkJavaInstallation() {
    try {
        runCommand('java -version');
        runCommand('javac -version');
        console.log('✓ Java is installed and configured');
        return true;
    } catch (error) {
        console.log('Java installation not found or not properly configured');
        return false;
    }
}

async function installJava() {
    console.log('Installing Java (Zulu JDK 17)...');
    try {
        // Check if Homebrew is installed
        try {
            runCommand('brew --version');
        } catch (error) {
            throw new Error('Homebrew is required but not installed. Please install Homebrew first.');
        }

        // Install Zulu JDK 17
        await runCommand('brew install --cask zulu@17');
        
        // Set JAVA_HOME
        const javaHome = '/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home';
        
        // Update shell profile file
        const homeDir = process.env.HOME;
        const shellProfile = `${homeDir}/.zshrc`; // You might want to check for .bash_profile as well
        
        const exportCommand = `\n# Java Configuration\nexport JAVA_HOME=${javaHome}\nexport PATH=$JAVA_HOME/bin:$PATH\n`;
        
        fs.appendFileSync(shellProfile, exportCommand);
        
        // Set for current session
        process.env.JAVA_HOME = javaHome;
        process.env.PATH = `${javaHome}/bin:${process.env.PATH}`;
        
        console.log('✓ Java installed and configured successfully');
        console.log('NOTE: Please restart your terminal or run:');
        console.log(`source ${shellProfile}`);
        
        // Verify installation
        const javaVersion = runCommand('java -version');
        console.log('Java installation verified:', javaVersion);
        
        return true;
    } catch (error) {
        console.error('Failed to install Java:', error.message);
        return false;
    }
}

async function validateJavaEnvironment() {
    console.log('Checking Java environment...');
    const hasJava = await checkJavaInstallation();
    
    if (!hasJava) {
        console.log('Java installation required. Starting installation process...');
        const javaInstalled = await installJava();
        if (!javaInstalled) {
            throw new Error('Failed to set up Java environment');
        }
    }
}

async function initializeConfig() {
    const configFile = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFile);
    const { WEBVIEW_CONFIG } = config;

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        console.error('WebView Config missing in', configPath);
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
        console.log('Configuration saved successfully.');
    } catch (error) {
        console.error('Failed to save configuration:', error);
        process.exit(1);
    }
}

function validateAndroidTools(androidConfig) {
    const ANDROID_SDK = androidConfig.sdkPath;
    const EMULATOR_PATH = `${ANDROID_SDK}/emulator/emulator`;
    const ADB_PATH = `${ANDROID_SDK}/platform-tools/adb`;

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
    return { EMULATOR_PATH, ADB_PATH };
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

async function setupAndroidEnvironment() {
    try {
        await validateJavaEnvironment();
        const { WEBVIEW_CONFIG } = await initializeConfig();
        const config = await validateAndCompleteConfig('android', configPath);
        
        // Validate Android tools
        const { EMULATOR_PATH, ADB_PATH } = validateAndroidTools(config.android);

        // Check and start emulator if needed
        const emulatorRunning = await checkEmulator(ADB_PATH);
        if (!emulatorRunning) {
            console.log('No emulator running, attempting to start one...');
            await startEmulator(EMULATOR_PATH, config.android);
        } else {
            console.log('Emulator already running, proceeding with installation...');
        }

        console.log('\nConfiguration Explanation:');
        console.log('WEBVIEW_CONFIG: Main configuration object for the WebView setup');
        console.log('├─ port: Port number for the WebView server');
        console.log('└─ android: Android-specific configuration');
        console.log('   ├─ buildType: Build type (debug/release)');
        console.log('   ├─ sdkPath: Android SDK path');
        console.log('   ├─ emulatorName: Selected Android emulator name');
        console.log('   └─ packageName: Android application package name');

        console.log('\nFinal Configuration:');
        console.log(JSON.stringify(config, null, 2));

    } catch (error) {
        console.error('Error in setup process:', error);
        process.exit(1);
    }
}

// Execute the main setup
setupAndroidEnvironment();