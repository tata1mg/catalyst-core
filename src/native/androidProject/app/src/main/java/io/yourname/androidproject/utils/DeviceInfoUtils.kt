package io.yourname.androidproject.utils

import android.content.Context
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import org.json.JSONObject
import io.yourname.androidproject.BuildConfig
import android.hardware.display.DisplayManager

object DeviceInfoUtils {
    private const val TAG = "DeviceInfoUtils"
    
    fun getDeviceInfo(context: Context): JSONObject {
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
            // Use modern Display API for Android 11+
            val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
            displayManager.getDisplay(0)?.getMetrics(displayMetrics)
        } else {
            // Fallback to deprecated API for older versions
            @Suppress("DEPRECATION")
            val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getMetrics(displayMetrics)
        }
        
        return displayMetrics
    }
}