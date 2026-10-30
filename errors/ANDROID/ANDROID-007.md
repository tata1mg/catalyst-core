# ANDROID-007

**Category:** ANDROID

## Message

No JDK 17 to 23 found

## Details

Gradle 8.13 and the Android SDK tools need JDK 17 to 23. None was found in JAVA_HOME, /usr/libexec/java_home or Android Studio's bundled runtime (a JDK 24 or newer is skipped), and none could be installed: this is not macOS, Homebrew is missing, or the install was declined.

## Suggested action

Install JDK 17 or 21 (macOS: brew install --cask zulu@17; Linux: your distribution's openjdk-17-jdk package) and set JAVA_HOME, or run catalyst buildApp:android in a terminal, or with --yes, to install it.
