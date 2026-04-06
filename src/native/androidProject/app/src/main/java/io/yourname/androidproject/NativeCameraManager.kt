@file:OptIn(androidx.camera.core.ExperimentalGetImage::class)

package io.yourname.androidproject

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.RectF
import android.util.Log
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.webkit.WebView
import android.widget.TextView
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import io.yourname.androidproject.utils.BridgeUtils
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class NativeCameraManager(
    private val activity: MainActivity,
    private val previewView: PreviewView,
    private val webView: WebView,
    private val debugOverlay: View? = null,
    private val debugQrStatus: TextView? = null,
    private val debugBarcodeOverlay: View? = null
) {

    companion object {
        private const val TAG = "NativeCameraManager"
        const val PERMISSION_REQUEST_CODE = 1001
    }

    private var cameraProvider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var isRunning = false
    private var viewfinderScreenRect: RectF? = null
    private var lastRotationDegrees: Int = 90

    private val scaleGestureDetector = ScaleGestureDetector(
        activity,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val cam = camera ?: return true
                val zoomState = cam.cameraInfo.zoomState.value ?: return true
                val currentRatio = zoomState.zoomRatio
                val minRatio = zoomState.minZoomRatio
                val maxRatio = zoomState.maxZoomRatio
                val newRatio = (currentRatio * detector.scaleFactor).coerceIn(minRatio, maxRatio)
                cam.cameraControl.setZoomRatio(newRatio)
                return true
            }
        }
    )

    fun onTouchEvent(event: MotionEvent): Boolean {
        return if (isRunning) scaleGestureDetector.onTouchEvent(event) else false
    }

    // Called from NativeBridge — checks permission then starts camera
    fun start(facing: String = "back", viewfinderRectJson: JSONObject? = null) {
        if (isRunning) return

        Log.d(TAG, "start() — viewfinderRectJson=$viewfinderRectJson")

        // jsRect: physical px relative to WebView top-left (what JS sends us).
        // Used as-is for debug overlay margins (parent RelativeLayout has same origin as WebView).
        // For QR filtering we need screen-absolute coords, so we add getLocationOnScreen() offset.
        var jsRect: RectF? = null

        viewfinderScreenRect = viewfinderRectJson?.let {
            try {
                val x = it.getDouble("x").toFloat()
                val y = it.getDouble("y").toFloat()
                val w = it.getDouble("width").toFloat()
                val h = it.getDouble("height").toFloat()

                jsRect = RectF(x, y, x + w, y + h)

                val webViewLocation = IntArray(2)
                webView.getLocationOnScreen(webViewLocation)
                val originX = webViewLocation[0].toFloat()
                val originY = webViewLocation[1].toFloat()

                val rect = RectF(x + originX, y + originY, x + originX + w, y + originY + h)
                Log.d(TAG, "webView origin on screen: x=$originX y=$originY")
                Log.d(TAG, "viewfinderScreenRect (screen-absolute): left=${rect.left} top=${rect.top} right=${rect.right} bottom=${rect.bottom} (${rect.width()}x${rect.height()})")
                rect
            } catch (e: Exception) {
                Log.w(TAG, "Failed to parse viewfinderRect: ${e.message}")
                null
            }
        }

        if (viewfinderScreenRect == null) {
            Log.w(TAG, "No viewfinderRect — all QR codes will be reported (no filtering)")
        }

        // DEBUG: overlay margin is relative to webview_container (same origin as WebView),
        // so use jsRect (no screen offset).
        jsRect?.let { rect ->
            activity.runOnUiThread {
                debugOverlay?.let { overlay ->
                    val lp = overlay.layoutParams as android.widget.RelativeLayout.LayoutParams
                    lp.leftMargin = rect.left.toInt()
                    lp.topMargin = rect.top.toInt()
                    lp.width = rect.width().toInt()
                    lp.height = rect.height().toInt()
                    overlay.layoutParams = lp
                    overlay.setBackgroundResource(R.drawable.debug_viewfinder_border)
                    overlay.visibility = View.VISIBLE
                    Log.d(TAG, "DEBUG overlay shown at: left=${rect.left} top=${rect.top} w=${rect.width()} h=${rect.height()}")
                }
            }
        }

        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            bindCamera(facing)
        } else {
            activity.requestPermissions(
                arrayOf(Manifest.permission.CAMERA),
                PERMISSION_REQUEST_CODE
            )
            // Permission result handled in onPermissionResult()
        }
    }

    fun stop() {
        cameraProvider?.unbindAll()
        cameraProvider = null
        camera = null
        isRunning = false
        activity.runOnUiThread {
            previewView.visibility = View.INVISIBLE
            debugOverlay?.visibility = View.GONE
        }
        BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.ON_VIDEO_STREAM_STOPPED)
        Log.d(TAG, "Camera stopped")
    }

    // Called by MainActivity.onRequestPermissionsResult
    fun onPermissionResult(granted: Boolean, facing: String = "back") {
        if (granted) {
            bindCamera(facing)
        } else {
            BridgeUtils.notifyWebError(
                webView,
                BridgeUtils.WebEvents.ON_CAMERA_ERROR,
                "Camera permission denied"
            )
        }
    }

    private fun bindCamera(facing: String) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(activity)

        cameraProviderFuture.addListener({
            try {
                cameraProvider = cameraProviderFuture.get()

                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }

                val imageAnalysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { analysis ->
                        analysis.setAnalyzer(cameraExecutor) { imageProxy ->
                            val mediaImage = imageProxy.image
                            if (mediaImage != null) {
                                val rotDeg = imageProxy.imageInfo.rotationDegrees
                                lastRotationDegrees = rotDeg
                                val image = InputImage.fromMediaImage(mediaImage, rotDeg)
                                // imageProxy.width/height are raw sensor dims (landscape at 90°/270°).
                                // InputImage rotates the image before ML Kit processes it, so ML Kit
                                // bounding boxes are in the post-rotation space — swap w/h for those rotations.
                                val imgW = if (rotDeg == 90 || rotDeg == 270) imageProxy.height else imageProxy.width
                                val imgH = if (rotDeg == 90 || rotDeg == 270) imageProxy.width else imageProxy.height
                                val scanner = BarcodeScanning.getClient()
                                scanner.process(image)
                                    .addOnSuccessListener { barcodes ->
                                        for (barcode in barcodes) {
                                            onQrDetected(barcode, imgW, imgH)
                                        }
                                    }
                                    .addOnCompleteListener { imageProxy.close() }
                            } else {
                                imageProxy.close()
                            }
                        }
                    }

                val selector = if (facing == "front") {
                    CameraSelector.DEFAULT_FRONT_CAMERA
                } else {
                    CameraSelector.DEFAULT_BACK_CAMERA
                }

                cameraProvider?.unbindAll()
                camera = cameraProvider?.bindToLifecycle(
                    activity as LifecycleOwner,
                    selector,
                    preview,
                    imageAnalysis
                )

                isRunning = true
                activity.runOnUiThread {
                    previewView.visibility = View.VISIBLE
                }

                BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.ON_VIDEO_STREAM_READY)
                Log.d(TAG, "Camera bound — facing=$facing")

            } catch (e: Exception) {
                Log.e(TAG, "Failed to bind camera", e)
                BridgeUtils.notifyWebError(
                    webView,
                    BridgeUtils.WebEvents.ON_CAMERA_ERROR,
                    "Failed to start camera: ${e.message}"
                )
            }
        }, ContextCompat.getMainExecutor(activity))
    }

    private fun onQrDetected(barcode: Barcode, imageWidth: Int, imageHeight: Int) {
        val value = barcode.rawValue ?: return

        // Filter by viewfinder region if one was provided
        val regionRect = viewfinderScreenRect
        if (regionRect != null) {
            val box = barcode.boundingBox
            if (box == null) {
                Log.w(TAG, "QR has no boundingBox, skipping filter for: $value")
            } else {
                // Map barcode bounding box from image space → screen space
                // PreviewView fills the screen; image may be rotated 90°, so swap w/h
                val previewW = previewView.width.toFloat()
                val previewH = previewView.height.toFloat()

                Log.d(TAG, "--- QR filter debug ---")
                Log.d(TAG, "  value: $value")
                Log.d(TAG, "  image size: ${imageWidth}x${imageHeight}")
                Log.d(TAG, "  previewView size: ${previewW.toInt()}x${previewH.toInt()}")
                Log.d(TAG, "  barcode box (image space): left=${box.left} top=${box.top} right=${box.right} bottom=${box.bottom}")
                Log.d(TAG, "  viewfinderRect (screen): left=${regionRect.left} top=${regionRect.top} right=${regionRect.right} bottom=${regionRect.bottom}")

                if (previewW == 0f || previewH == 0f) {
                    Log.w(TAG, "  previewView has zero size — skipping filter, passing QR through")
                } else {
                    // At 90° rotation (portrait): sensor image is landscape (640x480).
                    // ML Kit bounding box is in raw sensor/image space — axes are transposed
                    // AND origin shifts vs screen space:
                    //   image top    → screen left
                    //   image right  → screen top  (flipped: imageWidth - x)
                    //   image bottom → screen right
                    //   image left   → screen bottom
                    //
                    // At 270°: same transpose, opposite flip.
                    // At 0°/180°: axes align with screen, no transpose.
                    //
                    // We map all 4 corners to screen space and require the full box
                    // to be inside the viewfinder (not just the center).
                    val screenLeft: Float
                    val screenTop: Float
                    val screenRight: Float
                    val screenBottom: Float

                    // PreviewView uses FILL_CENTER — picks the larger scale axis, applies uniformly,
                    // and centers the rendered image. Compute the single uniform scale + center offset.
                    val scale = maxOf(previewW / imageWidth.toFloat(), previewH / imageHeight.toFloat())
                    val offsetX = (previewW - imageWidth * scale) / 2f
                    val offsetY = (previewH - imageHeight * scale) / 2f
                    screenLeft   = box.left   * scale + offsetX
                    screenTop    = box.top    * scale + offsetY
                    screenRight  = box.right  * scale + offsetX
                    screenBottom = box.bottom * scale + offsetY

                    val barcodeScreenRect = RectF(screenLeft, screenTop, screenRight, screenBottom)
                    val fullyInside = regionRect.contains(barcodeScreenRect)

                    Log.d(TAG, "  rotation: ${lastRotationDegrees}°")
                    Log.d(TAG, "  barcode box (screen): left=$screenLeft top=$screenTop right=$screenRight bottom=$screenBottom")
                    Log.d(TAG, "  viewfinder fully contains barcode: $fullyInside")

                    // Move green barcode box overlay to show where native thinks the QR is
                    val webViewLocation = IntArray(2)
                    webView.getLocationOnScreen(webViewLocation)
                    val webOriginX = webViewLocation[0].toFloat()
                    val webOriginY = webViewLocation[1].toFloat()
                    activity.runOnUiThread {
                        debugBarcodeOverlay?.let { bOverlay ->
                            val lp = bOverlay.layoutParams as android.widget.RelativeLayout.LayoutParams
                            lp.leftMargin = (screenLeft - webOriginX).toInt()
                            lp.topMargin = (screenTop - webOriginY).toInt()
                            lp.width = (screenRight - screenLeft).toInt()
                            lp.height = (screenBottom - screenTop).toInt()
                            bOverlay.layoutParams = lp
                            bOverlay.visibility = View.VISIBLE
                        }
                    }

                    if (!fullyInside) {
                        Log.d(TAG, "  FILTERED OUT — not fully inside viewfinder")
                        activity.runOnUiThread {
                            debugQrStatus?.setTextColor(android.graphics.Color.parseColor("#FF3B30"))
                            debugQrStatus?.text = "⬤ QR outside"
                        }
                        return
                    }
                    Log.d(TAG, "  PASSED — fully inside viewfinder")
                    activity.runOnUiThread {
                        debugQrStatus?.setTextColor(android.graphics.Color.parseColor("#34C759"))
                        debugQrStatus?.text = "⬤ QR inside"
                    }
                }
            }
        } else {
            Log.d(TAG, "No viewfinderRect set — no filtering for: $value")
        }

        val payload = JSONObject().apply {
            put("value", value)
            put("format", barcodeFormatName(barcode.format))
        }

        BridgeUtils.notifyWebJson(webView, BridgeUtils.WebEvents.ON_QR_DETECTED, payload)
        Log.d(TAG, "QR detected: $value")
    }

    private fun barcodeFormatName(format: Int): String = when (format) {
        Barcode.FORMAT_QR_CODE -> "QR"
        Barcode.FORMAT_EAN_13 -> "EAN_13"
        Barcode.FORMAT_EAN_8 -> "EAN_8"
        Barcode.FORMAT_CODE_128 -> "CODE_128"
        Barcode.FORMAT_CODE_39 -> "CODE_39"
        Barcode.FORMAT_DATA_MATRIX -> "DATA_MATRIX"
        Barcode.FORMAT_PDF417 -> "PDF417"
        Barcode.FORMAT_AZTEC -> "AZTEC"
        Barcode.FORMAT_UPC_A -> "UPC_A"
        Barcode.FORMAT_UPC_E -> "UPC_E"
        else -> "UNKNOWN"
    }

    fun cleanup() {
        stop()
        cameraExecutor.shutdown()
    }
}
