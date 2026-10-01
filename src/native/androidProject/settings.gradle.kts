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

// catalyst-ai — include when the npm package is installed.
// The package ships an /android library module (namespace io.catalyst.nativeai)
// for native AI; wire it here so Gradle picks it up. After running:
//   npm install catalyst-ai && npm run sync-packages -- --packages ai
// (an `ai.enabled=true` build syncs it automatically -- see
// buildAndroid/index.js:syncAIPackageIfEnabled). Also set ai.enabled=true in
// your app config to enable useLegacyPackaging for GPU dlopen().
val catalystAiDir = File(rootDir, "../node_modules/catalyst-ai/android")
if (catalystAiDir.exists()) {
    include(":catalyst-ai")
    project(":catalyst-ai").projectDir = catalystAiDir
}
