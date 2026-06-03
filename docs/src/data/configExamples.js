const baseWebviewConfig = {
    port: '3005',
    LOCAL_IP: '192.168.XX.XX',
    appInfo: 'android-v2.1.0',
    useHttps: true,
    android: {
        appName: 'My App',
        packageName: 'com.example.myapp',
        buildType: 'debug',
        sdkPath: '/Users/yourname/Library/Android/sdk',
        emulatorName: 'Pixel_5_API_30',
    },
    ios: {
        appName: 'My App',
        appBundleId: 'com.example.myapp',
        buildType: 'Debug',
        simulatorName: 'iPhone 17 Pro',
    },
    accessControl: {
        enabled: true,
        allowedUrls: ['https://api.example.com/*', '*.cdn.example.com'],
    },
    splashScreen: {
        duration: 2000,
        backgroundColor: '#ffffff',
        imageWidth: 120,
        imageHeight: 120,
        cornerRadius: 20,
    },
}

const appConfig = {
    NODE_SERVER_HOSTNAME: 'localhost',
    NODE_SERVER_PORT: 3005,
    WEBPACK_DEV_SERVER_HOSTNAME: 'localhost',
    WEBPACK_DEV_SERVER_PORT: 3006,
    BUILD_OUTPUT_PATH: 'build',
    PUBLIC_STATIC_ASSET_PATH: '/assets/',
    PUBLIC_STATIC_ASSET_URL: 'http://localhost:3006',
    NODE_ENV: 'development',
    API_URL: 'https://api.example.com',
    ANALYTICS_ID: 'UA-123456',
    CLIENT_ENV_VARIABLES: ['API_URL', 'ANALYTICS_ID'],
    WEBVIEW_CONFIG: baseWebviewConfig,
}

const universalAppConfig = {
    WEBVIEW_CONFIG: {
        ...baseWebviewConfig,
        android: {
            ...baseWebviewConfig.android,
            appName: 'My Awesome App',
            packageName: 'com.example.myawesomeapp',
            cachePattern: '*.css,*.js',
        },
        ios: {
            ...baseWebviewConfig.ios,
            appName: 'My Awesome App',
            appBundleId: 'com.example.myawesomeapp',
            cachePattern: '*.css,*.js',
        },
        accessControl: {
            enabled: true,
            allowedUrls: [
                'https://api.myapp.com/*',
                'https://cdn.myapp.com/*',
                '*.cloudfront.net',
            ],
        },
        notifications: {
            enabled: true,
        },
    },
}

const webviewConfigApi = {
    WEBVIEW_CONFIG: {
        ...baseWebviewConfig,
        appInfo: 'android-5Feb2026-v2.1.0',
        useHttps: false,
        accessControl: {
            enabled: true,
            allowedUrls: ['*.yourdomain.com*', 'http://localhost:*'],
        },
        splashScreen: {
            ...baseWebviewConfig.splashScreen,
            imageWidth: 400,
            imageHeight: 200,
        },
    },
}

export const configExamples = {
    appConfig,
    universalAppConfig,
    webviewConfigApi,
}
