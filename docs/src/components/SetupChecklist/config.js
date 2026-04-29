// Configuration data for different setup checklists

export const universalAppConfig = {
    id: 'universal-app-setup',
    title: 'Universal App Setup and Running Guide',
    description:
        'Complete guide to set up and run your Catalyst universal app with emulator configuration.',
    steps: [
        {
            id: 'create-app',
            title: 'Create Catalyst App',
            description: "Initialize a new Catalyst app if you haven't already",
            content:
                'Create a new Catalyst app using the create-catalyst-app command. This sets up the basic project structure with all necessary dependencies.',
            codeSnippet: 'npx create-catalyst-app@0.0.3-canary.9',
            estimatedTime: '5 minutes',
        },
        {
            id: 'get-local-ip',
            title: 'Get Local IP Address',
            description: 'Find your local IP address for emulator connectivity',
            content:
                'Navigate to your project directory and get your local IP address. This is required for the emulator to connect to your development server.',
            codeSnippet: `cd your-project-directory

# For Mac OS X - Using ifconfig
ifconfig | grep "inet " | grep -v 127.0.0.1`,
            estimatedTime: '2 minutes',
            dependencies: ['create-app'],
        },
        {
            id: 'config-setup',
            title: 'Configuration Setup',
            description: 'Replace localhost with your actual local IP address',
            content:
                'Update your configuration file to use your local IP address instead of localhost. This ensures proper connectivity between emulator and development server.',
            configExample: `{
  ...
  "NODE_SERVER_HOSTNAME": "YOUR_LOCAL_IP",
  "WEBPACK_DEV_SERVER_HOSTNAME": "YOUR_LOCAL_IP", 
  "PUBLIC_STATIC_ASSET_URL": "http://YOUR_LOCAL_IP:3005"
  ...
}`,
            estimatedTime: '3 minutes',
            dependencies: ['get-local-ip'],
        },
        {
            id: 'setup-emulator',
            title: 'Set up Emulator',
            description: 'Configure Android or iOS emulator for development',
            content:
                'Follow the detailed setup guides for Android or iOS emulator configuration. Choose the appropriate guide based on your target platform.',
            links: [
                {
                    text: 'Android Emulator Setup Guide',
                    url: '/content/Universal%20App/AndroidEmulatorSetup',
                },
                {
                    text: 'iOS Emulator Setup Guide',
                    url: '/content/Universal%20App/IosEmulatorSetup',
                },
            ],
            estimatedTime: '15 minutes',
            dependencies: ['config-setup'],
        },
        {
            id: 'start-dev-server',
            title: 'Start Development Server',
            description: 'Launch the development server',
            content:
                'Start the development server which will serve your app and provide hot reloading during development.',
            codeSnippet: 'npm run start',
            estimatedTime: '2 minutes',
            dependencies: ['setup-emulator'],
        },
        {
            id: 'build-app',
            title: 'Build and Run App',
            description: 'Build the app for your target platform',
            content:
                'In a new terminal window, build the app for your desired platform. Make sure the development server is still running.',
            codeSnippet: `# For Android
npm run buildApp:android

# For iOS
npm run buildApp:ios`,
            substeps: [
                'Open a new terminal window',
                'Navigate to your project directory',
                'Choose the appropriate build command for your platform',
                'Wait for the build process to complete',
                'The app should launch in your emulator/simulator',
            ],
            estimatedTime: '5-10 minutes',
            dependencies: ['start-dev-server'],
        },
    ],
}

export const androidSetupConfig = {
    id: 'android-emulator-setup',
    title: 'Android Emulator Setup Guide',
    description:
        'Complete guide to set up Android Studio and create virtual devices for app development.',
    steps: [
        {
            id: 'install-android-studio',
            title: 'Install Android Studio',
            description: 'Download and install Android Studio',
            content:
                'Download and install Android Studio, the official development environment for Android. This includes the emulator needed to test your app.',
            links: [
                {
                    text: 'Android Developer Website',
                    url: 'https://developer.android.com/studio',
                },
                {
                    text: 'JetBrains Toolbox App',
                    url: 'https://www.jetbrains.com/toolbox-app/',
                },
            ],
            substeps: [
                'Download from Android Developer website (~1GB download)',
                'Alternative: Install using JetBrains Toolbox (optional method)',
                'Run the installer and follow installation wizard',
                'Wait for installation to complete (requires ~4-8GB disk space)',
            ],
            estimatedTime: '20-40 minutes',
        },
        {
            id: 'configure-android-sdk',
            title: 'Configure Android SDK',
            description: 'Set up Android SDK with required components',
            content:
                'Launch Android Studio and configure the Android SDK with all necessary components for app development.',
            substeps: [
                'Launch Android Studio',
                'From the welcome screen, click More Actions and select SDK Manager',
                'Navigate to Settings > Languages & Frameworks > Android SDK',
                'In the SDK Platforms tab: Select the latest Android version (API level)',
                'Make sure the box next to the selected version is checked',
                'Switch to the SDK Tools tab and ensure these components are installed:',
                '  • At least one version of Android SDK Build-Tools',
                '  • Android Emulator',
                '  • Android SDK Platform-Tools',
                'Note down the Android SDK Location path displayed at the top',
                'Click Apply and then OK to begin the installation',
                'Wait for all selected components to download and install',
            ],
            estimatedTime: '5-8 minutes',
            dependencies: ['install-android-studio'],
        },
        {
            id: 'create-virtual-device',
            title: 'Create Virtual Device',
            description: 'Set up Android Virtual Device (AVD)',
            content:
                'Create an Android Virtual Device (emulator) that simulates a real Android phone for testing your app.',
            substeps: [
                'In Android Studio, click More Actions → Virtual Device Manager',
                'Click Create device',
                'Choose device type: Select a phone model (e.g., Pixel 7, Samsung Galaxy) that represents your target users',
                'Select Android version: Choose the latest Android version (API level) that your users typically have',
                'Choose device name: Use a simple name without spaces (e.g., testPhone, myEmulator, pixel7)',
                'Complete the setup by clicking Finish (this may download ~1-2GB system image)',
            ],
            estimatedTime: '5-10 minutes',
            dependencies: ['configure-android-sdk'],
        },
        {
            id: 'config-json-setup',
            title: 'Configuration Setup',
            description: 'Create config.json file with Android settings',
            content:
                'Create a config.json file in your project root directory with Android emulator configuration. This file tells your app how to connect to the Android emulator.',
            configExample: `{
  "WEBVIEW_CONFIG": {
    "port": "3005",
    "android": {
      "buildType": "debug",
      "emulatorName": "testPhone",
      "sdkPath": "/path/to/your/Android/sdk"
    }
  }
}`,
            substeps: [
                'Navigate to your project root directory (same level as package.json)',
                'Create a new file named "config.json" if it doesn\'t exist',
                'Update sdkPath: Your Android SDK location from step 2',
                'Update emulatorName: Use the exact device name from step 3 (avoid spaces - use testPhone, myEmulator, etc.)',
                'Update port: Keep as 3005 unless your development server uses a different port',
            ],
            estimatedTime: '2-3 minutes',
            dependencies: ['create-virtual-device'],
        },
        {
            id: 'run-emulator',
            title: 'Run the Emulator',
            description: 'Start the Android emulator',
            content:
                'Use the setupEmulator command to start your configured Android emulator. This command will validate your setup and launch the emulator.',
            codeSnippet: 'npm run setupEmulator:android',
            substeps: [
                'This command will validate your Android SDK setup',
                'Check for any running emulators',
                'Start the configured emulator if none is running',
            ],
            estimatedTime: '2-3 minutes',
            dependencies: ['config-json-setup'],
        },
    ],
}

export const iosSetupConfig = {
    id: 'ios-emulator-setup',
    title: 'iOS Emulator Setup Guide',
    description:
        'Complete guide to set up Xcode and iOS Simulator for app development.',
    steps: [
        {
            id: 'install-xcode',
            title: 'Install Xcode',
            description: 'Download and install Xcode from Mac App Store',
            content:
                "Install Xcode from the Mac App Store. This is Apple's official development environment and includes the iOS Simulator needed to test your app.",
            links: [
                {
                    text: 'Mac App Store - Xcode',
                    url: 'https://apps.apple.com/us/app/xcode/id497799835',
                },
            ],
            substeps: [
                'Open the Mac App Store',
                'Search for "Xcode"',
                'Click "Get" or "Install"',
                'Wait for download to complete (~10-15GB download, depends on internet speed)',
                'Installation will continue automatically after download',
            ],
            estimatedTime: '45-120 minutes',
        },
        {
            id: 'configure-xcode-tools',
            title: 'Configure Xcode Tools',
            description:
                'Set up Xcode command line tools and simulator components',
            content:
                'Install and configure Xcode Command Line Tools which are required for iOS development and simulator management.',
            codeSnippet: `# Check if already installed
xcode-select -p

# If not installed, run:
xcode-select --install`,
            substeps: [
                'Launch Xcode at least once to complete initial setup',
                'Accept any license agreements that appear',
                'Install additional components if prompted',
                'Verify command line tools are properly installed',
            ],
            estimatedTime: '3-5 minutes',
            dependencies: ['install-xcode'],
        },
        {
            id: 'setup-simulator',
            title: 'Set up iOS Simulator',
            description: 'Configure and launch iOS Simulator device',
            content:
                "Run the setup script to configure and launch the iOS simulator. You'll be able to select from available simulators.",
            codeSnippet: 'npm run setupEmulator:ios',
            substeps: [
                "You'll see a list of available simulators",
                'Enter the number of your desired simulator (e.g., 2 for iPhone 16 Pro)',
                'Remember the simulator name for configuration',
            ],
            estimatedTime: '2-3 minutes',
            dependencies: ['configure-xcode-tools'],
        },
        {
            id: 'config-json-setup',
            title: 'Configuration Setup',
            description: 'Create config.json file with iOS settings',
            content:
                'Create a config.json file in your project root directory with iOS simulator configuration. This file tells your app how to connect to the iOS simulator.',
            configExample: `{
  "WEBVIEW_CONFIG": {
    "port": "3005",
    "ios": {
      "buildType": "debug",
      "simulatorName": "iPhone 16 Pro",
      "appBundleId": "com.your.app"
    }
  }
}`,
            substeps: [
                'Navigate to your project root directory (same level as package.json)',
                'Create a new file named "config.json" if it doesn\'t exist',
                'Update simulatorName: Use the exact simulator name from step 3 (spaces are okay for iOS)',
                "Update appBundleId: Your app's unique identifier (e.g., com.yourcompany.yourapp)",
                'Update port: Keep as 3005 unless your development server uses a different port',
            ],
            estimatedTime: '2-3 minutes',
            dependencies: ['setup-simulator'],
        },
        {
            id: 'run-simulator',
            title: 'Run the Simulator',
            description: 'Start the iOS simulator and verify setup',
            content:
                'Verify that the iOS simulator launches correctly and displays the expected interface.',
            substeps: [
                'You should see the iOS device simulator window',
                'Default iOS home screen should be displayed',
                'Correct iOS version should be shown (e.g., iOS 18.1)',
                'Standard iOS apps and interface should be visible',
            ],
            estimatedTime: '1-2 minutes',
            dependencies: ['config-json-setup'],
        },
    ],
}
