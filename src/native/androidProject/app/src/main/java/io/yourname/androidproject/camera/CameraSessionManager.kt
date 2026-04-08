package io.yourname.androidproject.camera

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.util.Size
import android.view.View
import android.hardware.camera2.CaptureRequest
import android.util.Range
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import io.yourname.androidproject.MainActivity
import io.yourname.androidproject.utils.BridgeUtils
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Owns the CameraX session lifecycle: bind, stop, flip, setFps.
 */
class CameraSessionManager(
    private val activity: MainActivity,
    private val previewView: PreviewView,
    private val stateMachine: VideoStreamStateMachine,
    private val zoomController: ZoomController,
    private val torchController: TorchController,
    private val barcodeDetector: BarcodeDetector,
    private val onReady: () -> Unit,
    private val onStopped: () -> Unit,
    private val onError: (message: String) -> Unit
) {

    companion object {
        private const val TAG = "CameraSessionManager"
        const val PERMISSION_REQUEST_CODE = 1001
    }

    private var cameraProvider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    private var previewUseCase: Preview? = null
    private var imageAnalysisUseCase: ImageAnalysis? = null

    // Session params — stored so flip/setFps can rebind with same settings
    private var currentFacing: String = "back"
    private var currentFpsMin: Int? = null
    private var currentFpsMax: Int? = null
    private var currentScanFormat: String = "all"
    private var currentAutoZoom: Boolean = false
    private var currentInitialZoom: Float = 1.0f

    // ---- Public API ----

    fun start(
        facing: String,
        autoZoom: Boolean,
        initialZoomPct: Float,
        scanFormat: String,
        fpsMin: Int?,
        fpsMax: Int?
    ) {
        currentFacing = facing
        currentAutoZoom = autoZoom
        currentInitialZoom = initialZoomPct
        currentScanFormat = scanFormat
        currentFpsMin = fpsMin
        currentFpsMax = fpsMax

        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            bindCamera()
        } else {
            activity.requestPermissions(arrayOf(Manifest.permission.CAMERA), PERMISSION_REQUEST_CODE)
        }
    }

    fun stop() {
        cameraProvider?.unbindAll()
        cameraProvider = null
        camera = null
        previewUseCase = null
        imageAnalysisUseCase = null
        barcodeDetector.close()
        zoomController.detachCamera()
        torchController.detachCamera()
        activity.runOnUiThread {
            previewView.visibility = View.INVISIBLE
        }
        stateMachine.transition(VideoStreamState.IDLE)
        onStopped()
        Log.d(TAG, "Camera stopped")
    }

    fun flip() {
        val newFacing = if (currentFacing == "back") "front" else "back"
        Log.d(TAG, "flip() — $currentFacing → $newFacing")
        currentFacing = newFacing

        cameraProvider?.unbindAll()
        camera = null
        previewUseCase = null
        imageAnalysisUseCase = null
        barcodeDetector.close()
        zoomController.detachCamera()
        torchController.detachCamera()
        bindCamera()
    }

    fun setFps(min: Int?, max: Int?) {
        Log.d(TAG, "setFps($min, $max) — restarting session")
        currentFpsMin = min
        currentFpsMax = max
        cameraProvider?.unbindAll()
        camera = null
        previewUseCase = null
        imageAnalysisUseCase = null
        barcodeDetector.close()
        zoomController.detachCamera()
        torchController.detachCamera()
        bindCamera()
    }

    fun onPermissionResult(granted: Boolean) {
        if (granted) {
            bindCamera()
        } else {
            stateMachine.transition(VideoStreamState.IDLE)
            onError("Camera permission denied")
        }
    }

    fun cleanup() {
        stop()
        cameraExecutor.shutdown()
    }

    // ---- Internal ----

    private fun bindCamera() {
        val future = ProcessCameraProvider.getInstance(activity)
        future.addListener({
            try {
                cameraProvider = future.get()

                val previewBuilder = Preview.Builder()
                val fpsMin = currentFpsMin
                val fpsMax = currentFpsMax
                if (fpsMin != null && fpsMax != null) {
                    Camera2Interop.Extender(previewBuilder)
                        .setCaptureRequestOption(
                            CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                            Range(fpsMin, fpsMax)
                        )
                }
                previewUseCase = previewBuilder.build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }

                val resolutionSelector = ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            Size(1920, 1080),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                        )
                    )
                    .build()

                imageAnalysisUseCase = barcodeDetector.buildImageAnalysis(
                    executor = cameraExecutor,
                    resolutionSelector = resolutionSelector,
                    autoZoomEnabled = currentAutoZoom,
                    scanFormat = currentScanFormat
                )

                cameraProvider?.unbindAll()
                camera = cameraProvider?.bindToLifecycle(
                    activity as LifecycleOwner,
                    cameraSelector(currentFacing),
                    previewUseCase!!,
                    imageAnalysisUseCase!!
                )

                val cam = camera!!
                zoomController.attachCamera(cam)
                torchController.attachCamera(cam, currentFacing)

                zoomController.applyZoomMultiplier(currentInitialZoom)
                torchController.notifyReset()

                stateMachine.transition(VideoStreamState.STREAMING)

                activity.runOnUiThread {
                    previewView.visibility = View.VISIBLE
                    onReady()
                }
                Log.d(TAG, "Camera bound — facing=$currentFacing autoZoom=$currentAutoZoom")

            } catch (e: Exception) {
                Log.e(TAG, "Failed to bind camera", e)
                stateMachine.transition(VideoStreamState.IDLE)
                onError("Failed to start camera: ${e.message}")
            }
        }, ContextCompat.getMainExecutor(activity))
    }

    private fun cameraSelector(facing: String) =
        if (facing == "front") CameraSelector.DEFAULT_FRONT_CAMERA
        else CameraSelector.DEFAULT_BACK_CAMERA
}
