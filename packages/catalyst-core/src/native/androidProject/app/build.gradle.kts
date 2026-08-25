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

val configPath = findProperty("configPath") as? String
val keystorePassword: String? by project.properties  // Changed from keyStorePassword to keystorePassword
val keyAlias: String? by project.properties
val keyPassword: String? by project.properties

fun isAllowBackupEnabled(): Boolean {
    return try {
        val propsFile = File("${project.projectDir}/src/main/assets/webview_config.properties")
        if (!propsFile.exists()) return false
        val props = Properties()
        props.load(propsFile.inputStream())
        props.getProperty("android.security.allowBackup", "false").trim().lowercase() == "true"
    } catch (e: Exception) {
        false
    }
}

fun isNotificationsEnabled(): Boolean {
    return try {
        if (configPath != null) {
            val configFile = File(configPath)
            if (configFile.exists()) {
                val json = JSONObject(configFile.readText())
                if (json.has("WEBVIEW_CONFIG")) {
                    val webviewConfig = json.getJSONObject("WEBVIEW_CONFIG")
                    return webviewConfig.optJSONObject("notifications")?.optBoolean("enabled", false) ?: false
                }
            }
        }

        val generatedBuildProps = File("${project.projectDir}/catalyst-build.properties")
        if (generatedBuildProps.exists()) {
            val props = Properties()
            props.load(generatedBuildProps.inputStream())
            return props.getProperty("notifications.enabled", "false").trim().lowercase() == "true"
        }

        val webviewProps = File("${project.projectDir}/src/main/assets/webview_config.properties")
        if (webviewProps.exists()) {
            val props = Properties()
            props.load(webviewProps.inputStream())
            return props.getProperty("notifications.enabled", "false").trim().lowercase() == "true"
        }

        false
    } catch (e: Exception) {
        false
    }
}

fun isAIEnabled(): Boolean {
    return try {
        if (configPath == null) return false
        val configFile = File(configPath!!)
        if (!configFile.exists()) return false

        val json = JSONObject(configFile.readText())
        if (!json.has("WEBVIEW_CONFIG")) return false

        val webviewConfig = json.getJSONObject("WEBVIEW_CONFIG")
        webviewConfig.optJSONObject("ai")?.optBoolean("enabled", false) ?: false
    } catch (e: Exception) {
        false
    }
}

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
    jacoco
}

jacoco {
    toolVersion = libs.versions.jacoco.get()
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
        manifestPlaceholders["allowBackup"] = isAllowBackupEnabled()
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
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
            enableUnitTestCoverage = true
            buildConfigField("Boolean", "ALLOW_MIXED_CONTENT", "true")
            buildConfigField("String", "LOCAL_IP", "\"${getLocalIpAddress()}\"")
        }
        release {
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
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = "11"
        freeCompilerArgs += "-Xskip-metadata-version-check"
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
            excludes.add("META-INF/INDEX.LIST")
            excludes.add("META-INF/io.netty.versions.properties")
        }
        jniLibs {
            // libLiteRtClGlAccelerator.so must be extracted to disk for GPU dlopen().
            // This must live in the app module — AGP ignores useLegacyPackaging in library modules.
            useLegacyPackaging = isAIEnabled()
        }
    }

    // Configure lint options
    lint {
        checkReleaseBuilds = true
        abortOnError = true
    }

    // Configure test options for unit tests
    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }

    // Conditional source sets based on feature config
    sourceSets {
        getByName("main") {
            if (isNotificationsEnabled()) {
                logger.info("SourceSet selected: withFcm (notifications enabled)")
                java.srcDirs("src/withFcm/java")
            } else {
                logger.info("SourceSet selected: noFcm (notifications disabled)")
                java.srcDirs("src/noFcm/java")
            }
            // AI has no source-set swap — CatalystAIBridge self-registers via ServiceLoader
            // when @catalyst/cloud-ai is on the classpath.
        }
    }
}

configurations.all {
    resolutionStrategy.eachDependency {
        // kotlin-reflect is deliberately NOT forced here (unlike the
        // stdlib artifacts below) — mockito-kotlin 6.x requires
        // kotlin-reflect >=2.1.20, newer than this project's 2.0.21
        // compiler version. kotlin-reflect is forward-compatible with
        // older stdlib/compiler versions for the reflection use cases
        // actually exercised in tests, so it resolves to whatever's
        // requested (libs.kotlin.reflect, currently 2.1.20) instead.
        if (requested.group == "org.jetbrains.kotlin" &&
            (requested.name == "kotlin-stdlib" ||
             requested.name == "kotlin-stdlib-jdk7" ||
             requested.name == "kotlin-stdlib-jdk8")) {
            useVersion("2.0.21")
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.constraintlayout)
    testImplementation(libs.junit)
    // #413: Mockito for JVM unit tests (app/src/test). mockito-core 5.x
    // defaults to the inline mock-maker, so Kotlin's final classes don't
    // need extra `open` keywords. mockito-kotlin adds the idiomatic
    // whenever()/mock<T>() DSL on top. kotlinx-coroutines-test matches
    // the existing kotlinx-coroutines-android dependency's release line
    // for testing suspend funs in NativeBridge/OfflineCacheService.
    testImplementation(libs.mockito.core)
    testImplementation(libs.mockito.kotlin)
    testImplementation(libs.kotlin.reflect)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.googleid)
    implementation("org.json:json:20231013")
    // Ktor Server dependencies for FrameworkServer (~200KB total)
    implementation("io.ktor:ktor-server-core:3.0.3")
    implementation("io.ktor:ktor-server-netty:3.0.3")
    implementation("io.ktor:ktor-server-content-negotiation:3.0.3")
    implementation("io.ktor:ktor-server-sse:3.0.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Native AI — compileOnly always (for types), implementation only when ai.enabled=true (for runtime bundling)
    if (project.findProject(":catalyst-cloud-ai") != null) {
        compileOnly(project(":catalyst-cloud-ai"))
        if (isAIEnabled()) {
            implementation(project(":catalyst-cloud-ai"))
        }
    }

    // Security detection dependencies
    implementation("com.scottyab:rootbeer-lib:0.1.1")  // Root detection
    implementation("com.google.android.play:integrity:1.3.0")  // Play Integrity API

    // SLF4J simple logger for Ktor (optional, can be excluded if needed)
    implementation("org.slf4j:slf4j-simple:2.0.9")

    // CameraX
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")

    // ML Kit Barcode Scanning
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    // Notification dependencies - conditional based on config
    if (isNotificationsEnabled()) {
        implementation("androidx.localbroadcastmanager:localbroadcastmanager:1.1.0")
        implementation("com.google.firebase:firebase-messaging:23.4.0")
        implementation("com.google.firebase:firebase-analytics:21.5.0")
    }
}

// JVM unit test coverage (Tier 1). Mirrors the CatalystCoreLogic
// llvm-cov setup on iOS (#432): real, measured line coverage for
// app/src/test, not just a pass/fail count. Scoped to testDebugUnitTest —
// enableUnitTestCoverage=true on the debug build type (above) already
// makes Gradle emit the raw .exec coverage data; this task turns that
// into the human/CI-readable XML + HTML report.
tasks.register<JacocoReport>("jacocoTestReport") {
    dependsOn("testDebugUnitTest")
    group = "verification"
    description = "Generates JVM unit test coverage report for app/src/test (Tier 1)."

    reports {
        xml.required.set(true)
        html.required.set(true)
    }

    // Excludes are split into two groups. The first is generated/non-authored
    // code (R.class, BuildConfig, view/data binding scaffolding) — no
    // coverage story either way, always excluded.
    //
    // The second is the Tier 2 classification below: files that build real
    // Android Views, extend Activity/Fragment, or otherwise structurally
    // require Robolectric or a real device/emulator to exercise (confirmed
    // via a full-repo classification pass, not a guess from filenames —
    // see PR description / issue for the per-file reasoning). These ARE
    // real, authored logic — excluding them isn't "inflating" the number,
    // it's making the gate honest: a Tier 1/Tier 2 coverage gate that
    // includes Tier 2 in its denominator would fail any PR that touches
    // WebView/Activity/View code regardless of how well-tested that PR's
    // actual testable logic is. Mirrors the CoreLogic/UI split already
    // accepted on iOS (#432).
    //
    // Each Tier 2 file's top-level class, Kt-file facade, and compiled
    // lambda/inner classes are all excluded, so nothing structurally
    // untestable is left counting against the gate. The one exception is
    // NativeBridge, which has an already-tested companion object
    // (parseAndValidateMessage, compiled separately as
    // NativeBridge$Companion.class) — Gradle's Ant-style exclude() does
    // not reliably support "!" negation, so instead of pattern-negating
    // the companion out, its lambda exclude uses "$*$*" (two "$"
    // segments), which Kotlin lambda class names always have and the
    // single-"$" companion class name never does. See the comment next
    // to that pattern below for the concrete example.
    val generatedCodeFilter = listOf(
        "**/R.class", "**/R$*.class",
        "**/BuildConfig.*",
        "**/Manifest*.*",
        "**/*Test*.*",
        "android/**/*.*",
        "**/databinding/**",
        "**/android/databinding/**",
        "**/androidx/databinding/**",
        "**/*_ViewBinding*.*",
        "**/*\$ViewInjector*.*",
        "**/*\$ViewBinder*.*",
        "**/*_MembersInjector.class"
    )

    val tier2FrameworkBoundFilter = listOf(
        // Real WebView/Activity construction, ViewBinding, real lifecycle.
        // Each file's top-level class, Kt-file facade, and compiled lambda
        // classes (Kotlin: OuterClass$methodName$N.class) are all excluded.
        // None of these files has a companion object worth protecting
        // (that only applies to NativeBridge, handled separately below),
        // so a plain "$*" is safe here.
        "**/CustomWebView.class", "**/CustomWebView\$*.class", "**/CustomWebViewKt.class",
        "**/MainActivity.class", "**/MainActivity\$*.class",
        "**/SplashActivity.class", "**/SplashActivity\$*.class",
        "**/NativeCameraManager.class", "**/NativeCameraManager\$*.class",
        "**/camera/CameraSessionManager.class", "**/camera/CameraSessionManager\$*.class",
        "**/TransitionManager.class", "**/TransitionManager\$*.class",
        "**/utils/KeyboardUtil.class", "**/utils/KeyboardUtil\$*.class",
        "**/security/SecurityAlertUI.class", "**/security/SecurityAlertUI\$*.class",
        "**/security/SecurityAlertHandler.class", "**/security/SecurityAlertHandler\$*.class",
        "**/security/SecurityBottomSheet.class", "**/security/SecurityBottomSheet\$*.class",
        // NativeBridge has an already-tested companion (parseAndValidateMessage,
        // compiled as NativeBridge$Companion.class — one "$"). Kotlin lambda
        // classes always carry two "$" segments (e.g.
        // NativeBridge$downloadAndOpenFile$1.class), so "$*$*" excludes every
        // lambda while a single-"$" glob would be needed to also exclude the
        // companion — which this pattern does NOT match, by construction.
        "**/NativeBridge.class", "**/NativeBridgeKt.class", "**/NativeBridge\$*\$*.class"
    )

    val debugTree = fileTree(layout.buildDirectory.dir("intermediates/javac/debug/compileDebugJavaWithJavac/classes")) {
        exclude(generatedCodeFilter + tier2FrameworkBoundFilter)
    }
    val kotlinDebugTree = fileTree(layout.buildDirectory.dir("tmp/kotlin-classes/debug")) {
        exclude(generatedCodeFilter + tier2FrameworkBoundFilter)
    }
    // Both noFcm/withFcm are listed (not just whichever isNotificationsEnabled()
    // picked for this build) purely so the HTML report can resolve source
    // lines for whichever one actually got compiled — listing the inactive
    // one is harmless, Jacoco just won't find matching class files for it.
    val sourceDirs = listOf(
        "${project.projectDir}/src/main/java",
        "${project.projectDir}/src/noFcm/java",
        "${project.projectDir}/src/withFcm/java"
    )

    sourceDirectories.setFrom(files(sourceDirs))
    classDirectories.setFrom(files(debugTree, kotlinDebugTree))
    executionData.setFrom(fileTree(layout.buildDirectory) {
        include("outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec")
    })
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
            try {
                val keys = jsonObj.keys()
        
                while (keys.hasNext()) {
                    val key = keys.next()
                    val value = jsonObj.opt(key)
                    val fullKey = if (prefix.isEmpty()) key else "$prefix.$key"
                    
                    when (value) {
                        is org.json.JSONObject -> {
                            extractProperties(value, fullKey)
                        }
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
            } catch (e: Exception) {
                throw RuntimeException("Failed to extract properties from JSON at prefix: $prefix", e)
            }
        }

        extractProperties(webviewConfig)

        // Extract splash screen configuration with defaults
        if (webviewConfig.has("splashScreen")) {
            val splashConfig = webviewConfig.getJSONObject("splashScreen")
            properties.setProperty("splashScreen.enabled", "true")
            
            // Duration in milliseconds
            if (splashConfig.has("duration")) {
                properties.setProperty("splashScreen.duration", splashConfig.get("duration").toString())
            } else {
                properties.setProperty("splashScreen.duration", "1000")
            }
            
            // Background color
            if (splashConfig.has("backgroundColor")) {
                properties.setProperty("splashScreen.backgroundColor", splashConfig.getString("backgroundColor"))
            } else {
                properties.setProperty("splashScreen.backgroundColor", "#ffffff")
            }
            
            // Image dimensions
            if (splashConfig.has("imageWidth")) {
                properties.setProperty("splashScreen.imageWidth", splashConfig.get("imageWidth").toString())
            } else {
                properties.setProperty("splashScreen.imageWidth", "120")
            }
            
            if (splashConfig.has("imageHeight")) {
                properties.setProperty("splashScreen.imageHeight", splashConfig.get("imageHeight").toString())
            } else {
                properties.setProperty("splashScreen.imageHeight", "120")
            }
            
            // Corner radius
            if (splashConfig.has("cornerRadius")) {
                properties.setProperty("splashScreen.cornerRadius", splashConfig.get("cornerRadius").toString())
            } else {
                properties.setProperty("splashScreen.cornerRadius", "20")
            }
        } else {
            // No splash screen configuration, disable it
            properties.setProperty("splashScreen.enabled", "false")
        }

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

if (isNotificationsEnabled()) {
    apply(plugin = "com.google.gms.google-services")
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

            project.exec {
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
            
            Location: ${layout.buildDirectory.get().asFile}/outputs/bundle/release/app-release.aab
            
            Next steps:
            1. Test your bundle with: 
               bundletool build-apks --bundle=app/build/outputs/bundle/release/app-release.aab --output=test.apks
            
            2. Upload to Play Console: https://play.google.com/console
            =======================================================
        """.trimIndent())
    }
}
