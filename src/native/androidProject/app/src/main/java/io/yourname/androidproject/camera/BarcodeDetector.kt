package io.yourname.androidproject.camera

import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.ZoomSuggestionOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService

/**
 * Wraps ML Kit barcode scanning.
 * Builds the scanner with format filter and optional auto-zoom.
 * Fires [onDetected] for each barcode found in a frame.
 */
class BarcodeDetector(
    private val zoomController: ZoomController,
    private val onDetected: (barcode: Barcode, imageWidth: Int, imageHeight: Int) -> Unit
) {

    private val TAG = "BarcodeDetector"

    private var scanner: BarcodeScanner? = null

    /** scan: "qr" | "barcode" | "all" */
    fun buildImageAnalysis(
        executor: ExecutorService,
        resolutionSelector: androidx.camera.core.resolutionselector.ResolutionSelector,
        autoZoomEnabled: Boolean,
        scanFormat: String
    ): ImageAnalysis {
        val formats = resolveFormats(scanFormat)
        val optionsBuilder = BarcodeScannerOptions.Builder()
            .setBarcodeFormats(formats.first(), *formats.drop(1).toIntArray())

        if (autoZoomEnabled) {
            Log.d(TAG, "Auto-zoom enabled, wiring ZoomSuggestionOptions")
            optionsBuilder.setZoomSuggestionOptions(
                ZoomSuggestionOptions.Builder { suggestedRatio ->
                    zoomController.onAutoZoomSuggestion(suggestedRatio)
                }
                .setMaxSupportedZoomRatio(zoomController.currentMaxZoomRatio())
                .build()
            )
        }

        scanner = BarcodeScanning.getClient(optionsBuilder.build())
        val activeScanner = scanner!!

        return ImageAnalysis.Builder()
            .setResolutionSelector(resolutionSelector)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
            .also { analysis ->
                analysis.setAnalyzer(executor) { imageProxy ->
                    processFrame(imageProxy, activeScanner)
                }
            }
    }

    fun close() {
        scanner?.close()
        scanner = null
    }

    private fun processFrame(imageProxy: ImageProxy, activeScanner: BarcodeScanner) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val rotDeg = imageProxy.imageInfo.rotationDegrees
        val image = InputImage.fromMediaImage(mediaImage, rotDeg)
        // Swap w/h for 90°/270° — ML Kit boxes are in post-rotation space
        val imgW = if (rotDeg == 90 || rotDeg == 270) imageProxy.height else imageProxy.width
        val imgH = if (rotDeg == 90 || rotDeg == 270) imageProxy.width else imageProxy.height

        activeScanner.process(image)
            .addOnSuccessListener { barcodes ->
                barcodes.forEach { onDetected(it, imgW, imgH) }
            }
            .addOnCompleteListener { imageProxy.close() }
    }

    private fun resolveFormats(scan: String): List<Int> = when (scan) {
        "qr"      -> listOf(Barcode.FORMAT_QR_CODE)
        "barcode" -> listOf(
            Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8,
            Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39,
            Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E,
            Barcode.FORMAT_PDF417
        )
        else      -> listOf(Barcode.FORMAT_ALL_FORMATS)
    }

    companion object {
        fun formatName(format: Int): String = when (format) {
            Barcode.FORMAT_QR_CODE    -> "QR"
            Barcode.FORMAT_EAN_13     -> "EAN_13"
            Barcode.FORMAT_EAN_8      -> "EAN_8"
            Barcode.FORMAT_CODE_128   -> "CODE_128"
            Barcode.FORMAT_CODE_39    -> "CODE_39"
            Barcode.FORMAT_DATA_MATRIX -> "DATA_MATRIX"
            Barcode.FORMAT_PDF417     -> "PDF417"
            Barcode.FORMAT_AZTEC      -> "AZTEC"
            Barcode.FORMAT_UPC_A      -> "UPC_A"
            Barcode.FORMAT_UPC_E      -> "UPC_E"
            else                      -> "UNKNOWN"
        }
    }
}
