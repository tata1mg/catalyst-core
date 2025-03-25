import java.net.NetworkInterface
import java.io.File
import java.util.Properties

val configPath: String? by project.properties

fun getLocalIpAddress(): String {
    return NetworkInterface.getNetworkInterfaces().toList()
        .flatMap { it.inetAddresses.toList() }
        .filter { !it.isLoopbackAddress && it.hostAddress.indexOf(':') == -1 }
        .map { it.hostAddress }
        .firstOrNull() ?: "127.0.0.1"
}

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrains.kotlin.android)
}

android {
    namespace = "com.example.androidProject"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.androidProject"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "LOCAL_IP", "\"${getLocalIpAddress()}\"")
    }

    buildTypes {
        debug {
            manifestPlaceholders += mapOf("allowCleartextTraffic" to true)
            isMinifyEnabled = false
            buildConfigField("Boolean", "ALLOW_MIXED_CONTENT", "true")
            buildConfigField("String", "LOCAL_IP", "\"${getLocalIpAddress()}\"")
        }
        release {
            manifestPlaceholders += mapOf("allowCleartextTraffic" to false)
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            buildConfigField("Boolean", "ALLOW_MIXED_CONTENT", "false")
            buildConfigField("String", "LOCAL_IP", "\"127.0.0.1\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes.add("**/route-manifest.json.gz")
            excludes.add("**/route-manifest.json.br")
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.constraintlayout)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.json:json:20231013")
}

// Task to verify local IP
tasks.register("printLocalIp") {
    doLast {
        println("Local IP Address: ${getLocalIpAddress()}")
    }
}

tasks.register("updateSdkPath") {
    doLast {
        val sdkPath: String? by project.properties

        if (sdkPath == null) {
            throw GradleException(
                """
                SDK path not provided!
                Please provide the SDK path using -PsdkPath=/path/to/sdk
                Example: ./gradlew updateSdkPath -PsdkPath=/path/to/android/sdk
                """.trimIndent()
            )
        }

        val localProperties = File(project.rootDir, "local.properties")
        val properties = Properties()

        if (localProperties.exists()) {
            properties.load(localProperties.inputStream())
        }

        properties.setProperty("sdk.dir", sdkPath)
        properties.store(localProperties.outputStream(), "Updated SDK Path")

        println("Updated SDK path to: $sdkPath")
    }
}

// Task to generate WebView config
tasks.register("generateWebViewConfig") {
    doLast {
        val configJsonPath = configPath ?: throw GradleException(
            """
            Config path not provided! 
            Please provide the config path using -PconfigPath=/path/to/your/config.json
            Example: ./gradlew generateWebViewConfig -PconfigPath=/path/to/your/config.json
            """.trimIndent()
        )

        val configJsonFile = File(configJsonPath)
        if (!configJsonFile.exists()) {
            throw GradleException("Config file not found at: $configJsonPath")
        }

        val configContent = configJsonFile.readText()

        // Extract WEBVIEW_CONFIG section
        val webviewConfigRegex = """"WEBVIEW_CONFIG"\s*:\s*\{([^}]*)\}""".toRegex()
        val webviewConfigMatch = webviewConfigRegex.find(configContent)
        val webviewConfigContent = webviewConfigMatch?.groupValues?.get(1)

        val properties = Properties()
        properties.setProperty("LOCAL_IP", getLocalIpAddress())

        // Parse top-level properties
        val topLevelRegex = """"([^"]+)"\s*:\s*"([^"]+)"""".toRegex()
        webviewConfigContent?.let {
            topLevelRegex.findAll(it).forEach { matchResult ->
                val (key, value) = matchResult.destructured
                if (key != "android") {
                    properties.setProperty(key, value)
                }
            }
        }

        // Parse android object specifically
        val androidRegex = """"android"\s*:\s*\{([^}]*)\}""".toRegex()
        val androidMatch = androidRegex.find(webviewConfigContent ?: "")
        val androidContent = androidMatch?.groupValues?.get(1)

        // Parse android object properties
        val androidPropsRegex = """"([^"]+)"\s*:\s*"([^"]+)"""".toRegex()
        androidContent?.let {
            androidPropsRegex.findAll(it).forEach { matchResult ->
                val (key, value) = matchResult.destructured
                properties.setProperty("android.$key", value)
            }
        }

        // Create the assets directory if it doesn't exist
        val assetsDir = File("${project.projectDir}/src/main/assets")
        if (!assetsDir.exists()) {
            assetsDir.mkdirs()
            println("Created assets directory at ${assetsDir.absolutePath}")
        }

        // Write to properties file
        File(assetsDir, "webview_config.properties").outputStream().use {
            properties.store(it, "WebView Configuration")
        }

        println("WebView config generated at ${assetsDir.absolutePath}/webview_config.properties")
    }
}