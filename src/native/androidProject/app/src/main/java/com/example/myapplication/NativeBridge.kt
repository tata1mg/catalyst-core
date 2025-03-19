package com.example.myapplication

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.provider.MediaStore
import android.util.Log
import android.webkit.WebView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import android.util.Base64

import com.example.androidProject.MainActivity

class NativeBridge(private val activity: MainActivity, private val webview: WebView) {
    private lateinit var cameraLauncher: ActivityResultLauncher<Intent>
    private lateinit var permissionLauncher: ActivityResultLauncher<String>

    companion object {
        private const val CAMERA_PERMISSION = Manifest.permission.CAMERA
        private const val TAG = "NativeBridge"
    }

    init {
        cameraLauncher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK) {
                val bitmapImage = result.data?.extras?.get("data") as? Bitmap
                if (bitmapImage != null) {
                    val base64Image = convertBitmapToBase64(bitmapImage)
                    Log.d(TAG, "Image captured: $bitmapImage")
                    webview.evaluateJavascript("window.WebBridge.callback('ON_CAMERA_CAPTURE', '$base64Image')", null)
                }

            } else {
                Log.e(TAG, "Camera capture failed or was cancelled")
            }
        }

        permissionLauncher = activity.registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { isGranted ->
            if (isGranted) {
                Log.d(TAG, "Camera permission granted, launching camera")
                launchCamera()
            } else {
                Log.e(TAG, "Camera permission denied")
                webview.evaluateJavascript(
                    "window.WebBridge.callback('Camera permission denied')",
                    null
                )
            }
        }
    }

    @android.webkit.JavascriptInterface
    fun logger() {
        activity.runOnUiThread {
            Log.d(TAG, "Message from native")
        }
        webCallback()
    }

    @android.webkit.JavascriptInterface
    fun openCamera() {
        activity.runOnUiThread {
            Log.d(TAG, "openCamera")
            // Permission already granted
            if (ContextCompat.checkSelfPermission(
                    activity,
                    CAMERA_PERMISSION
                ) == PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "Camera permission already granted")
                launchCamera()
            }
            // Request permission
            else {
                Log.d(TAG, "Requesting camera permission")
                permissionLauncher.launch(CAMERA_PERMISSION)
            }
        }
    }

    private fun convertBitmapToBase64(bitmap: Bitmap): String {
        val outputStream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, outputStream)
        val byteArray = outputStream.toByteArray()
        return Base64.encodeToString(byteArray, Base64.DEFAULT)
    }

    private fun launchCamera() {
        val cameraIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        if (cameraIntent.resolveActivity(activity.packageManager) != null) {
            cameraLauncher.launch(cameraIntent)
        } else {
            Log.e(TAG, "No camera app available.")
            webview.evaluateJavascript(
                "window.WebBridge.callback('No camera app found')",
                null
            )
        }
    }

    private fun webCallback() {
        activity.runOnUiThread {
            val jsCode = "window.WebBridge.callback('From native, with regards')"
            webview.evaluateJavascript(jsCode, null)
        }
    }
}