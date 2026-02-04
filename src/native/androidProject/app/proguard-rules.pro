# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Keep line numbers for debugging
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep JavaScript interface for WebView
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep NativeBridge class (JavaScript interface)
-keep class io.yourname.androidproject.NativeBridge {
    public *;
}

# Keep Kotlin coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-dontwarn kotlinx.coroutines.**

# Keep Ktor
-keep class io.ktor.** { *; }
-keepclassmembers class io.ktor.** { volatile <fields>; }
-dontwarn io.ktor.**

# Keep Netty (used by Ktor server)
-keep class io.netty.** { *; }
-keepclassmembers class io.netty.** { *; }
-dontwarn io.netty.**

# Suppress warnings for optional Netty dependencies (not needed on Android)
-dontwarn io.netty.internal.tcnative.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.eclipse.jetty.npn.**
-dontwarn reactor.blockhound.integration.**
-dontwarn org.apache.log4j.**
-dontwarn org.apache.logging.log4j.**

# Keep WebViewClient overrides
-keepclassmembers class * extends android.webkit.WebViewClient {
    public void *(android.webkit.WebView, java.lang.String);
    public void *(android.webkit.WebView, java.lang.String, android.graphics.Bitmap);
    public boolean *(android.webkit.WebView, java.lang.String);
}

# Keep WebChromeClient overrides
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public void *(android.webkit.WebView, java.lang.String);
}

# Keep data classes used for caching
-keep class io.yourname.androidproject.WebCacheManager$CacheEntry { *; }
-keep class io.yourname.androidproject.WebCacheManager$CacheMetadata { *; }

# Keep RootBeer library for root detection
-keep class com.scottyab.rootbeer.** { *; }
-dontwarn com.scottyab.rootbeer.**

# Security: keep only the public API surface that MainActivity wires up.
# Detection internals (EmulatorDetector, FridaDetector) and UI classes
# (SecurityBottomSheet, SecurityAlertUI) are intentionally obfuscated.
-keep class io.yourname.androidproject.security.SecurityCheckScheduler {
    public static void initialize(android.content.Context, kotlinx.coroutines.CoroutineScope, io.yourname.androidproject.security.SecurityCheckScheduler$SecurityCheckCallback);
}
-keep interface io.yourname.androidproject.security.SecurityCheckScheduler$SecurityCheckCallback {
    public void onSecurityCheckComplete(org.json.JSONObject);
}
-keep class io.yourname.androidproject.security.SecurityCheckManager {
    public static org.json.JSONObject getLatestSecurityResults(android.content.Context);
    public static java.lang.String getSecurityMode(android.content.Context);
}
-keep class io.yourname.androidproject.security.SecurityAlertHandler {
    public static void handleSecurityCheckResults(android.app.Activity, org.json.JSONObject);
}

# Keep Play Integrity API
-keep class com.google.android.play.core.integrity.** { *; }
-dontwarn com.google.android.play.core.integrity.**

# Remove debug logging in release builds
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}