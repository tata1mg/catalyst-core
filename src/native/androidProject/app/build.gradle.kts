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

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
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
}

// Task to verify local IP
tasks.register("printLocalIp") {
    doLast {
        println("Local IP Address: ${getLocalIpAddress()}")
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
        // Read the config file
        val configContent = configJsonFile.readText()
            .trim()
            .removeSurrounding("{", "}")

        // Parse config content
        val configs = mutableMapOf<String, String>()

        // Extract WEBVIEW_CONFIG section
        val webviewConfigRegex = """"WEBVIEW_CONFIG"\s*:\s*\{([^}]*)\}""".toRegex()
        val webviewConfigMatch = webviewConfigRegex.find(configContent)
        val webviewConfigContent = webviewConfigMatch?.groupValues?.get(1)

        // Parse WEBVIEW_CONFIG content if found
        webviewConfigContent?.split(",")?.forEach { pair ->
            val keyValue = pair.split(":", limit = 2)
            if (keyValue.size == 2) {
                val key = keyValue[0].trim().trim('"')
                val value = keyValue[1].trim().trim('"')
                configs[key] = value
            }
        }

        // Create the assets directory if it doesn't exist
        val assetsDir = File("${project.projectDir}/src/main/assets")
        if (!assetsDir.exists()) {
            assetsDir.mkdirs()
            println("Created assets directory at ${assetsDir.absolutePath}")
        }

        // Create and write to properties file
        val properties = Properties()
        properties.setProperty("LOCAL_IP", getLocalIpAddress())
        configs.forEach { (key, value) ->
            properties.setProperty(key, value)
        }

        File(assetsDir, "webview_config.properties").outputStream().use {
            properties.store(it, "WebView Configuration")
        }

        println("WebView config generated at ${assetsDir.absolutePath}/webview_config.properties")
    }
}

