package io.yourname.androidproject.utils

import android.content.Context
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import org.json.JSONObject
import io.yourname.androidproject.BuildConfig
import java.util.Properties

object DeviceInfoUtils {
    private const val TAG = "DeviceInfoUtils"
    
    fun getDeviceInfo(context: Context, properties: Properties? = null): JSONObject {
        val deviceInfo = JSONObject()
        
        try {
            // Basic device information
            deviceInfo.apply {
                put("model", Build.MODEL)
                put("manufacturer", Build.MANUFACTURER)
                put("platform", "android")
            }
            
            // Screen dimensions only
            val displayMetrics = getDisplayMetrics(context)
            deviceInfo.apply {
                put("screenWidth", displayMetrics.widthPixels)
                put("screenHeight", displayMetrics.heightPixels)
                put("screenDensity", displayMetrics.density.toDouble())
            }
            
            // Add build version from properties
            properties?.let {
                val buildVersion = it.getProperty("buildVersion", "unknown")
                deviceInfo.put("buildVersion", buildVersion)
            }
            
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error getting device info", e)
            return JSONObject().apply {
                put("error", "Failed to get device info: ${e.message}")
            }
        }
        
        return deviceInfo
    }
    
    private fun getDisplayMetrics(context: Context): DisplayMetrics {
        val displayMetrics = DisplayMetrics()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Use WindowMetrics API for Android 11+ (provides accurate app window bounds)
            val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val windowMetrics = windowManager.currentWindowMetrics
            val bounds = windowMetrics.bounds

            // Populate DisplayMetrics with window bounds
            displayMetrics.widthPixels = bounds.width()
            displayMetrics.heightPixels = bounds.height()

            // Get density from resources (still accurate)
            displayMetrics.density = context.resources.displayMetrics.density
            displayMetrics.densityDpi = context.resources.displayMetrics.densityDpi
        } else {
            // Fallback to deprecated API for Android 10 and below
            @Suppress("DEPRECATION")
            val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getMetrics(displayMetrics)
        }

        return displayMetrics
    }
}