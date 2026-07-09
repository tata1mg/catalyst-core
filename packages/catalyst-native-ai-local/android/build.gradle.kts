plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.catalyst.nativeai"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = "11"
        freeCompilerArgs += "-Xskip-metadata-version-check"
    }


}

configurations.all {
    resolutionStrategy.eachDependency {
        if (requested.group == "org.jetbrains.kotlin" &&
            (requested.name == "kotlin-stdlib" ||
             requested.name == "kotlin-stdlib-jdk7" ||
             requested.name == "kotlin-stdlib-jdk8" ||
             requested.name == "kotlin-reflect")) {
            useVersion("2.0.21")
        }
    }
}

dependencies {
    // catalyst-core app module — provides AIBridge, BridgeUtils, FrameworkServerUtils.
    // compileOnly: these classes come from the app at runtime; don't bundle them.
    compileOnly(project(":app"))

    // LiteRT-LM — on-device LLM inference
    // Pinned: 0.14.0 introduced an OpenCL sampler regression (litertlm.cc OnError
    // "Can not find OpenCL library" on first generate, even via Backend.CPU()).
    implementation("com.google.ai.edge.litertlm:litertlm-android:0.13.1")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.json:json:20231013")
}
