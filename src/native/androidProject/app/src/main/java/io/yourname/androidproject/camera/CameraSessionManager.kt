package io.yourname.androidproject.camera

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.util.Size
import android.view.View
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
 * Implements HoldController.AnalyzerController so HoldController can
 * unbind/rebind the analysis use-case independently of preview.
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
) : HoldController.AnalyzerController {

    companion object {
        private const val TAG = "CameraSessionManager"
        const val PERMISSION_REQUEST_CODE = 1001
    }

    private var cameraProvider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    // Use-case refs held at class level so hold can unbind/rebind analyzer independently
    private var previewUseCase: Preview? = null
    private var imageAnalysisUseCase: ImageAnalysis? = null

    // Session params — stored so flip/setFps can rebind with same settings
    private var currentFacing: String = "back"
    private var currentFpsMin: Int? = null
    private var currentFpsMax: Int? = null
    private var currentScanFormat: String = "qr"
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
        activity.runOnUiThread { previewView.visibility = View.INVISIBLE }
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

    // ---- HoldController.AnalyzerController ----

    override fun unbindAnalyzer() {
        val provider = cameraProvider
        val analysis = imageAnalysisUseCase
        if (provider != null && analysis != null) {
            activity.runOnUiThread { provider.unbind(analysis) }
        }
    }

    override fun rebindAnalyzer() {
        val prov = cameraProvider ?: return
        val analysisUC = imageAnalysisUseCase ?: return
        val selector = cameraSelector(currentFacing)
        try {
            prov.bindToLifecycle(activity as LifecycleOwner, selector, analysisUC)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to rebind analyzer after hold: ${e.message}")
        }
    }

    // ---- Internal ----

    private fun bindCamera() {
        val future = ProcessCameraProvider.getInstance(activity)
        future.addListener({
            try {
                cameraProvider = future.get()

                previewUseCase = Preview.Builder().build().also {
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

                activity.runOnUiThread { previewView.visibility = View.VISIBLE }
                onReady()
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
