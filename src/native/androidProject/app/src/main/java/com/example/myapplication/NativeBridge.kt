package com.example.myapplication

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Log
import android.webkit.WebView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import android.util.Base64
import androidx.core.content.FileProvider
import com.example.androidProject.MainActivity
import android.content.Context
import android.os.Environment
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class NativeBridge(private val activity: MainActivity, private val webview: WebView) {
    private var currentPhotoUri: Uri? = null
    private val FILE_PROVIDER_AUTHORITY = "com.example.androidProject.fileprovider"

    private lateinit var cameraLauncher: ActivityResultLauncher<Uri>
    private lateinit var permissionLauncher: ActivityResultLauncher<String>


    companion object {
        private const val CAMERA_PERMISSION = Manifest.permission.CAMERA
        private const val TAG = "NativeBridge"
    }

    init {
        initializeCameraLauncher()
        initializePermissionLauncher()
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
            if (hasCameraPermission()) {
                launchCamera()
            } else {
                requestCameraPermission()
            }
        }
    }

    private fun webCallback() {
        activity.runOnUiThread {
            val jsCode = "window.WebBridge.callback('From native, with regards')"
            webview.evaluateJavascript(jsCode, null)
        }
    }

    private fun initializeCameraLauncher() {
        cameraLauncher = activity.registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
            if (success) {
                currentPhotoUri?.let { uri ->
                    try {
                        val base64Image = convertUriToBase64(activity, uri)
                        val imageUrl = uri.toString()

                        val json = JSONObject().apply {
//                            put("base64", base64Image)
                            put("imageUrl", imageUrl)
                        }.toString()

                        val jsCode = "window.WebBridge.callback('ON_CAMERA_CAPTURE', '$json')"
                        webview.evaluateJavascript(
                            jsCode,
                            null
                        )
                    } catch (e: Exception) {
                        Log.e(TAG, "Error processing image: ${e.message}")
                    }
                } ?: run {
                    Log.e(TAG, "Photo URI is null")
                }
            } else {
                Log.e(TAG, "Camera capture failed or was cancelled")
            }
        }
    }

    private fun initializePermissionLauncher() {
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

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            activity,
            CAMERA_PERMISSION
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestCameraPermission() {
        Log.d(TAG, "Requesting camera permission")
        permissionLauncher.launch(CAMERA_PERMISSION)
    }

    private fun launchCamera() {
        val photoFile = createImageFile()
        currentPhotoUri = FileProvider.getUriForFile(
            activity,
            FILE_PROVIDER_AUTHORITY,
            photoFile
        )

        currentPhotoUri?.let { uri ->
            try {
                cameraLauncher.launch(uri)
            } catch (e: Exception) {
                Log.e(TAG, "Camera launch failed: ${e.message}")
            }
        } ?: run {
            Log.e(TAG, "Failed to create photo URI")
        }
    }

    private fun createImageFile(): File {
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        val storageDir = activity.getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        return File.createTempFile(
            "JPEG_${timeStamp}_",
            ".jpg",
            storageDir
        ).apply {
            parentFile?.mkdirs()
        }
    }

    private fun convertUriToBase64(context: Context, uri: Uri): String? {
        return try {
            val inputStream: InputStream? = context.contentResolver.openInputStream(uri)
            val bytes = inputStream?.readBytes()
            inputStream?.close()
            Base64.encodeToString(bytes, Base64.DEFAULT)
        } catch (e: Exception) {
            Log.e(TAG, "Base64 conversion error: ${e.message}")
            null
        }
    }
}