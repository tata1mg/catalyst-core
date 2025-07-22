import java.net.NetworkInterface
import java.io.File
import java.util.Properties
import org.json.JSONObject
import org.json.JSONArray

buildscript {
    dependencies {
        classpath("org.json:json:20231013")
    }
}

val configPath: String? by project.properties
val keystorePassword: String? by project.properties  // Changed from keyStorePassword to keystorePassword
val keyAlias: String? by project.properties
val keyPassword: String? by project.properties

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
    namespace = "io.yourname.androidproject"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.yourname.androidproject"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "LOCAL_IP", "\"${getLocalIpAddress()}\"")
    }

    // Add signing configuration for app bundle
    signingConfigs {
        create("release") {
            // Make sure the keystore file exists before referencing it
            val keystoreFile = file("../keystore/release-key.jks")
            if (keystoreFile.exists()) {
               storeFile = file("../keystore/release-key.jks")
                storePassword = "test@123"
                keyAlias = "release"
                keyPassword = "test@123"
            } else {
                // Log a warning if the keystore doesn't exist yet
                logger.warn("Keystore file not found at ${keystoreFile.absolutePath}. Run the generateKeystore task first.")
            }
        }
    }

    buildTypes {
        debug {
            manifestPlaceholders += mapOf("allowCleartextTraffic" to true)
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
            buildConfigField("Boolean", "ALLOW_MIXED_CONTENT", "true")
            buildConfigField("String", "LOCAL_IP", "\"${getLocalIpAddress()}\"")
        }
        release {
            manifestPlaceholders += mapOf("allowCleartextTraffic" to false)
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            buildConfigField("Boolean", "ALLOW_MIXED_CONTENT", "false")
            buildConfigField("String", "LOCAL_IP", "\"127.0.0.1\"")

            // Only apply signing config if the keystore exists
            if (file("../keystore/release-key.jks").exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    // Configure App Bundle settings
    bundle {
        language {
            enableSplit = true
        }
        density {
            enableSplit = true
        }
        abi {
            enableSplit = true
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
            excludes.add("META-INF/LICENSE")
            excludes.add("META-INF/NOTICE")
        }
    }

    // Configure lint options
    lint {
        checkReleaseBuilds = true
        abortOnError = true
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
    implementation("androidx.core:core-splashscreen:1.0.1")
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
        
        val jsonObject = JSONObject(configContent)
        
        if (!jsonObject.has("WEBVIEW_CONFIG")) {
            throw GradleException("WEBVIEW_CONFIG not found in config file")
        }
        
        val webviewConfig = jsonObject.getJSONObject("WEBVIEW_CONFIG")
        
        val properties = Properties()

        // Set different IP based on build type
        if (gradle.startParameter.taskNames.any { it.contains("Release") || it.contains("release") }) {
            properties.setProperty("LOCAL_IP", "127.0.0.1") // Production
            properties.setProperty("buildType", "release")
            properties.setProperty("buildOptimisation", "true")
        } else {
            properties.setProperty("LOCAL_IP", getLocalIpAddress()) // Debug
            properties.setProperty("buildType", "debug")
            properties.setProperty("buildOptimisation", "false")
        }

        fun extractProperties(jsonObj: org.json.JSONObject, prefix: String = "") {
            val keys = jsonObj.keys()

            while (keys.hasNext()) {
                val key = keys.next()
                val value = jsonObj.opt(key)
                val fullKey = if (prefix.isEmpty()) key else "$prefix.$key"
                
                when (value) {
                    is org.json.JSONObject -> {
                         extractProperties(value, fullKey)
                    }
                    // Only supports array of strings
                    is org.json.JSONArray -> {
                        val arrayValues = (0 until value.length()).map { i ->
                            value.opt(i).toString()
                        }.joinToString(",")
                        properties.setProperty(fullKey, arrayValues)
                    }
                    else -> {
                         properties.setProperty(fullKey, value.toString())
                    }
                }
            }
        }

        extractProperties(webviewConfig)

        // Set production-specific properties for release builds
        if (gradle.startParameter.taskNames.any { it.contains("Release") || it.contains("release") }) {
            properties.setProperty("PRODUCTION_URL", "https://yourwebapp.com") // Replace with your domain
            properties.setProperty("apiBaseUrl", "https://api.yourdomain.com/") // Replace with your API URL
        }

        // Create the assets directory if it doesn't exist
        val assetsDir = File("${project.projectDir}/src/main/assets")
        if (!assetsDir.exists()) {
            assetsDir.mkdirs()
        }

        // Write to properties file
        File(assetsDir, "webview_config.properties").outputStream().use {
            properties.store(it, "WebView Configuration")
        }
    }
}

// Task to create key store if it doesn't exist
// Add this task to your build.gradle.kts
tasks.register("generateKeystore") {
    doLast {
        val keystoreDir = File(project.rootDir, "keystore")
        if (!keystoreDir.exists()) {
            keystoreDir.mkdirs()
        }

        val keystoreFile = File(keystoreDir, "release-key.jks")
        if (!keystoreFile.exists()) {
            val storePass = project.properties["keystorePassword"] as? String ?: System.getenv("KEYSTORE_PASSWORD") ?: "android"
            val keyPass = project.properties["keyPassword"] as? String ?: System.getenv("KEY_PASSWORD") ?: "android"
            val alias = project.properties["keyAlias"] as? String ?: System.getenv("KEY_ALIAS") ?: "release"

            exec {
                commandLine = listOf(
                    "keytool",
                    "-genkey",
                    "-v",
                    "-keystore", keystoreFile.absolutePath,
                    "-alias", alias,
                    "-keyalg", "RSA",
                    "-keysize", "2048",
                    "-validity", "10000",
                    "-storepass", storePass,
                    "-keypass", keyPass,
                    "-dname", "CN=YourCompany, OU=YourDepartment, O=YourOrganization, L=YourCity, ST=YourState, C=US"
                )
            }
            println("Generated keystore at: ${keystoreFile.absolutePath}")
        } else {
            println("Keystore already exists at: ${keystoreFile.absolutePath}")
        }
    }
}
// Task to build app bundle
tasks.register("createAppBundle") {
    dependsOn("generateKeystore", "bundleRelease")
    doLast {
        println("""
            =======================================================
            App Bundle created successfully!
            
            Location: ${project.buildDir}/outputs/bundle/release/app-release.aab
            
            Next steps:
            1. Test your bundle with: 
               bundletool build-apks --bundle=app/build/outputs/bundle/release/app-release.aab --output=test.apks
            
            2. Upload to Play Console: https://play.google.com/console
            =======================================================
        """.trimIndent())
    }
}