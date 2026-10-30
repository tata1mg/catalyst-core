const baseWebviewConfig = {
    appId: 'com.yourcompany.myapp',
    appName: 'My App',
    url: 'https://www.myapp.com',
    port: '3005',
    LOCAL_IP: 'localhost',
    appInfo: 'android-v2.1.0',
    profiler: {
        enabled: false,
    },
    android: {
        emulatorName: 'Pixel_8_API_36',
    },
    ios: {
        simulatorName: 'iPhone 17 Pro',
    },
    accessControl: {
        enabled: true,
        allowedUrls: ['https://api.example.com/*', '*.cdn.example.com'],
    },
    splashScreen: {
        duration: 2000,
        minDuration: 0,
        backgroundColor: '#ffffff',
        imageWidth: 120,
        imageHeight: 120,
        cornerRadius: 20,
    },
}

const appConfig = {
    NODE_SERVER_HOSTNAME: 'localhost',
    NODE_SERVER_PORT: 3005,
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
        appId: 'com.yourcompany.myawesomeapp',
        appName: 'My Awesome App',
        android: {
            ...baseWebviewConfig.android,
            cachePattern: '*.css,*.js',
        },
        ios: {
            ...baseWebviewConfig.ios,
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
