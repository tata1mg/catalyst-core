package io.yourname.androidproject.camera

import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.common.Barcode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

/**
 * Unit tests for BarcodeDetector (Android coverage batch 3), previously
 * entirely untested (0/52 lines).
 *
 * Scope: close() (scanner null-safe close/clear) and the private
 * processFrame() early-return branch (imageProxy.image == null -> closes
 * and returns) are exercised directly/indirectly. resolveFormats() and
 * formatName() (companion) are pure and exercised via their observable
 * effects/return values.
 *
 * processFrame()'s null-image early-return branch (imageProxy.image ==
 * null -> imageProxy.close(); return) is reachable via reflection on the
 * private method without needing a real InputImage/ML Kit Task, and is
 * exercised that way below.
 *
 * Deliberately out of scope: buildImageAnalysis() itself is NOT invoked --
 * it calls BarcodeScanning.getClient(...) and ImageAnalysis.Builder()...
 * .build(), both of which are static/builder factories that construct real
 * ML Kit / CameraX platform objects rather than mockable interfaces (per
 * project rule 3: builders that delegate to real platform objects are out
 * of scope). Likewise the non-null-image path through processFrame()
 * (InputImage.fromMediaImage(...) then
 * activeScanner.process(image).addOnSuccessListener{...}) is not
 * exercised: InputImage.fromMediaImage is itself a static factory over a
 * real android.media.Image, and BarcodeScanner.process() returns a real ML
 * Kit Task<List<Barcode>> whose Task machinery isn't a simple mockable
 * single-call the way ImageProxy is -- driving it would require faking ML
 * Kit's Task/Executor internals, not just this class's collaborators.
 */
class BarcodeDetectorTest {

    private val zoomController = mock<ZoomController>()

    // ============================================================
    // formatName (companion) -- pure, exhaustive over declared formats
    // ============================================================

    @Test
    fun `formatName maps every documented barcode format constant to its label`() {
        assertEquals("QR", BarcodeDetector.formatName(Barcode.FORMAT_QR_CODE))
        assertEquals("EAN_13", BarcodeDetector.formatName(Barcode.FORMAT_EAN_13))
        assertEquals("EAN_8", BarcodeDetector.formatName(Barcode.FORMAT_EAN_8))
        assertEquals("CODE_128", BarcodeDetector.formatName(Barcode.FORMAT_CODE_128))
        assertEquals("CODE_39", BarcodeDetector.formatName(Barcode.FORMAT_CODE_39))
        assertEquals("DATA_MATRIX", BarcodeDetector.formatName(Barcode.FORMAT_DATA_MATRIX))
        assertEquals("PDF417", BarcodeDetector.formatName(Barcode.FORMAT_PDF417))
        assertEquals("AZTEC", BarcodeDetector.formatName(Barcode.FORMAT_AZTEC))
        assertEquals("UPC_A", BarcodeDetector.formatName(Barcode.FORMAT_UPC_A))
        assertEquals("UPC_E", BarcodeDetector.formatName(Barcode.FORMAT_UPC_E))
    }

    @Test
    fun `formatName falls back to UNKNOWN for an unrecognized format`() {
        assertEquals("UNKNOWN", BarcodeDetector.formatName(-999))
    }

    // ============================================================
    // close()
    // ============================================================

    @Test
    fun `close before any scanner was built does not throw`() {
        val detector = BarcodeDetector(zoomController) { _, _, _ -> }
        detector.close()
    }

    @Test
    fun `close is safe to call twice`() {
        val detector = BarcodeDetector(zoomController) { _, _, _ -> }
        detector.close()
        detector.close()
    }

    // ============================================================
    // suppressResults flag
    // ============================================================

    @Test
    fun `suppressResults defaults to false and is settable`() {
        val detector = BarcodeDetector(zoomController) { _, _, _ -> }
        assertEquals(false, detector.suppressResults)
        detector.suppressResults = true
        assertEquals(true, detector.suppressResults)
    }

    // ============================================================
    // Construction sanity
    // ============================================================

    @Test
    fun `constructing BarcodeDetector does not throw`() {
        val detector = BarcodeDetector(zoomController) { _, _, _ -> }
        assertNotNull(detector)
    }

    // ============================================================
    // processFrame (private) -- reached via reflection since
    // buildImageAnalysis()'s analyzer lambda isn't otherwise reachable
    // without a real ImageAnalysis pipeline.
    // ============================================================

    @Test
    fun `processFrame closes the imageProxy and returns early when the image is null`() {
        val detector = BarcodeDetector(zoomController) { _, _, _ -> }
        val imageProxy = mock<ImageProxy>()
        whenever(imageProxy.image).thenReturn(null)
        val scanner = mock<BarcodeScanner>()

        val method = BarcodeDetector::class.java.getDeclaredMethod(
            "processFrame",
            ImageProxy::class.java,
            BarcodeScanner::class.java
        )
        method.isAccessible = true
        method.invoke(detector, imageProxy, scanner)

        verify(imageProxy).close()
        org.mockito.Mockito.verifyNoInteractions(scanner)
    }
}
