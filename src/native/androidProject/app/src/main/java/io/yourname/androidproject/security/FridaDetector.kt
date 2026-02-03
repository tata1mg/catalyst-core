package io.yourname.androidproject.security

import android.os.Build
import io.yourname.androidproject.utils.BridgeUtils
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.Socket

/**
 * Local Frida and hooking framework detection.
 * Checks for common Frida indicators without external telemetry.
 */
object FridaDetector {
    private const val TAG = "FridaDetector"

    // Frida default ports
    private val FRIDA_PORTS = listOf(27042, 27043)

    // Frida-related library names
    private val FRIDA_LIBRARIES = setOf(
        "frida-agent",
        "frida-gadget",
        "frida",
        "libfrida",
        "re.frida"
    )

    // Xposed/Substrate indicators
    private val HOOKING_LIBRARIES = setOf(
        "xposed",
        "edxposed",
        "substrate",
        "cydia"
    )

    /**
     * Performs multiple checks to detect Frida or other hooking frameworks.
     * Returns true if hooking indicators are found.
     */
    fun isFridaDetected(): Boolean {
        try {
            val checks = listOf(
                checkFridaPorts(),
                checkLoadedLibraries(),
                checkFridaFiles(),
                checkHookingFrameworks()
            )

            // If any check is positive, consider Frida detected
            val isDetected = checks.any { it }

            if (isDetected) {
                val positiveChecks = checks.count { it }
                BridgeUtils.logDebug(TAG, "Hooking framework detected (${positiveChecks}/4 checks positive)")
            }

            return isDetected
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error during Frida detection", e)
            return false
        }
    }

    /**
     * Check if Frida default ports are listening
     */
    private fun checkFridaPorts(): Boolean {
        return FRIDA_PORTS.any { port ->
            try {
                Socket().use { socket ->
                    val address = java.net.InetSocketAddress("127.0.0.1", port)
                    socket.connect(address, 2000)  // 2 second timeout
                    socket.isConnected
                }
            } catch (e: Exception) {
                // Connection failed or timed out - no Frida on this port
                false
            }
        }
    }

    /**
     * Check loaded libraries for Frida indicators
     */
    private fun checkLoadedLibraries(): Boolean {
        try {
            // Read /proc/self/maps to check loaded libraries
            val mapsFile = File("/proc/self/maps")
            if (!mapsFile.exists()) return false

            // optimization: read line-by-line using BufferedReader (via useLines)
            // instead of loading entire file into memory with readText()
            var isDetected = false
            mapsFile.useLines { lines ->
                for (line in lines) {
                    val lowerLine = line.lowercase()
                    
                    // Check for Frida/Hooking libs
                    if (FRIDA_LIBRARIES.any { lowerLine.contains(it) } || 
                        HOOKING_LIBRARIES.any { lowerLine.contains(it) }) {
                        isDetected = true
                        break 
                    }
                }
            }
            return isDetected
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error checking loaded libraries", e)
            return false
        }
    }

    /**
     * Check for Frida-related files on the filesystem
     */
    private fun checkFridaFiles(): Boolean {
        try {
            val suspiciousFiles = listOf(
                "/data/local/tmp/frida-server",
                "/data/local/tmp/re.frida.server",
                "/sdcard/frida-server",
                "/system/bin/frida-server",
                "/system/xbin/frida-server"
            )

            return suspiciousFiles.any { File(it).exists() }
        } catch (e: Exception) {
            return false
        }
    }

    /**
     * Check for common hooking frameworks (Xposed, EdXposed, Substrate)
     */
    private fun checkHookingFrameworks(): Boolean {
        try {
            // Check for Xposed-related environment
            val hasXposedBridge = try {
                Class.forName("de.robv.android.xposed.XposedBridge")
                true
            } catch (e: ClassNotFoundException) {
                false
            }

            if (hasXposedBridge) return true

            // Check for Xposed installer
            val xposedFiles = listOf(
                "/system/framework/XposedBridge.jar",
                "/system/lib/libxposed_art.so",
                "/system/lib64/libxposed_art.so"
            )

            val hasXposedFiles = xposedFiles.any { File(it).exists() }
            if (hasXposedFiles) return true

            // Check for Substrate
            val hasSubstrate = try {
                Class.forName("com.saurik.substrate.MS")
                true
            } catch (e: ClassNotFoundException) {
                false
            }

            return hasSubstrate
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error checking hooking frameworks", e)
            return false
        }
    }

    /**
     * Check if debugger is attached
     */
    private fun isDebuggerConnected(): Boolean {
        return android.os.Debug.isDebuggerConnected()
    }

    /**
     * Get detailed Frida detection info for debugging
     */
    fun getFridaCheckDetails(): Map<String, Any> {
        return mapOf(
            "isFridaDetected" to isFridaDetected(),
            "portCheck" to checkFridaPorts(),
            "libraryCheck" to checkLoadedLibraries(),
            "fileCheck" to checkFridaFiles(),
            "hookingFrameworkCheck" to checkHookingFrameworks(),
            "debuggerConnected" to isDebuggerConnected(),
            "isDebuggable" to (Build.FINGERPRINT.lowercase().contains("test-keys") ||
                             Build.TAGS.lowercase().contains("test-keys"))
        )
    }
}
