pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-serialization:1.9.0")
    }
}


dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}


rootProject.name = "Catalyst Application"
include(":app")

// @catalyst/cloud-ai — include when the package is installed.
// The npm package ships an /android library module for native AI; wire it here so Gradle picks it up.
// After running: npm install @catalyst/cloud-ai && npm run sync-packages -- --packages cloud-ai
// Also set ai.enabled=true in your app config to enable useLegacyPackaging for GPU dlopen().
val cloudAiDir = File(rootDir, "../node_modules/@catalyst/cloud-ai/android")
if (cloudAiDir.exists()) {
    include(":catalyst-cloud-ai")
    project(":catalyst-cloud-ai").projectDir = cloudAiDir
}
