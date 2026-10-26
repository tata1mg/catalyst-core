# ANDROID-007

**Category:** ANDROID

## Message

Java 17 or newer not found

## Details

Gradle and the Android SDK tools need JDK 17 or newer. None was found in JAVA_HOME, /usr/libexec/java_home or Android Studio's bundled runtime, and installing one with Homebrew needs a yes in an interactive terminal on macOS.

## Suggested action

Install JDK 17 or newer (macOS: brew install --cask zulu@17; Linux: your distribution's openjdk-17-jdk package) and set JAVA_HOME, or run catalyst setupEmulator:android in a terminal to install it.
