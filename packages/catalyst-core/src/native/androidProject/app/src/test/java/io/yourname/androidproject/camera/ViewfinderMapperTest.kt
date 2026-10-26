package io.yourname.androidproject.camera

import android.webkit.WebView
import org.json.JSONObject
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify

/**
 * Unit tests for ViewfinderMapper (Android coverage batch 3), previously
 * entirely untested (0/30 lines).
 *
 * Both functions are pure coordinate math with a single mockable
 * collaborator call (WebView.getLocationOnScreen(IntArray)). All lines
 * (the guard branches, the scale/offset math, and the success/failure
 * paths of parseViewfinderRect) execute under test and are covered by
 * jacoco -- but the *values* the math produces cannot be asserted here:
 * android.graphics.RectF is a stub under this project's mockable
 * android.jar (isReturnDefaultValues=true, confirmed empirically -- a
 * `RectF(10f, 20f, 110f, 70f)` constructed in a test reads back left/top/
 * right/bottom as 0.0, since the constructor body that assigns those
 * public fields never runs). Per the PerfEventBufferTest/MetricsMonitorTest
 * precedent of documenting and moving on rather than reaching for
 * Robolectric, this file verifies null/non-null outcomes and observable
 * collaborator interactions (webView.getLocationOnScreen being invoked)
 * instead of exact coordinate values.
 */
class ViewfinderMapperTest {

    // ============================================================
    // parseViewfinderRect
    // ============================================================

    @Test
    fun `parseViewfinderRect returns a non-null pair and reads the WebView origin on well-formed JSON`() {
        val json = JSONObject().apply {
            put("x", 10.0)
            put("y", 20.0)
            put("width", 100.0)
            put("height", 50.0)
        }
        val webView = mock<WebView>()

        val result = ViewfinderMapper.parseViewfinderRect(json, webView)

        assertNotNull(result)
        verify(webView).getLocationOnScreen(any())
    }

    @Test
    fun `parseViewfinderRect returns null when a required field is missing`() {
        val json = JSONObject().apply {
            put("x", 10.0)
            put("y", 20.0)
            // "width" and "height" deliberately omitted -- json.getDouble
            // throws a JSONException, caught and mapped to null.
        }
        val webView = mock<WebView>()

        val result = ViewfinderMapper.parseViewfinderRect(json, webView)

        assertNull(result)
    }

    @Test
    fun `parseViewfinderRect does not call getLocationOnScreen when JSON parsing fails first`() {
        val json = JSONObject() // no fields at all
        val webView = mock<WebView>()

        ViewfinderMapper.parseViewfinderRect(json, webView)

        // x is read before webView.getLocationOnScreen is called -- an
        // empty JSON object throws on the very first getDouble("x").
        org.mockito.Mockito.verifyNoInteractions(webView)
    }

    // ============================================================
    // mapBarcodeToScreen
    // ============================================================

    @Test
    fun `mapBarcodeToScreen returns null when previewWidth is zero`() {
        val result = ViewfinderMapper.mapBarcodeToScreen(
            boxLeft = 0, boxTop = 0, boxRight = 100, boxBottom = 100,
            imageWidth = 640, imageHeight = 480,
            previewWidth = 0f, previewHeight = 800f
        )
        assertNull(result)
    }

    @Test
    fun `mapBarcodeToScreen returns null when previewHeight is zero`() {
        val result = ViewfinderMapper.mapBarcodeToScreen(
            boxLeft = 0, boxTop = 0, boxRight = 100, boxBottom = 100,
            imageWidth = 640, imageHeight = 480,
            previewWidth = 600f, previewHeight = 0f
        )
        assertNull(result)
    }

    @Test
    fun `mapBarcodeToScreen returns null when imageWidth is zero`() {
        val result = ViewfinderMapper.mapBarcodeToScreen(
            boxLeft = 0, boxTop = 0, boxRight = 100, boxBottom = 100,
            imageWidth = 0, imageHeight = 480,
            previewWidth = 600f, previewHeight = 800f
        )
        assertNull(result)
    }

    @Test
    fun `mapBarcodeToScreen returns null when imageHeight is zero`() {
        val result = ViewfinderMapper.mapBarcodeToScreen(
            boxLeft = 0, boxTop = 0, boxRight = 100, boxBottom = 100,
            imageWidth = 640, imageHeight = 0,
            previewWidth = 600f, previewHeight = 800f
        )
        assertNull(result)
    }

    @Test
    fun `mapBarcodeToScreen returns non-null for valid non-square dimensions, exercising the FILL_CENTER scale math`() {
        val result = ViewfinderMapper.mapBarcodeToScreen(
            boxLeft = 100, boxTop = 100, boxRight = 200, boxBottom = 200,
            imageWidth = 640, imageHeight = 480,
            previewWidth = 400f, previewHeight = 400f
        )
        assertNotNull(result)
    }

    @Test
    fun `mapBarcodeToScreen returns non-null when preview and image aspect ratios match`() {
        val result = ViewfinderMapper.mapBarcodeToScreen(
            boxLeft = 0, boxTop = 0, boxRight = 640, boxBottom = 480,
            imageWidth = 640, imageHeight = 480,
            previewWidth = 320f, previewHeight = 240f
        )
        assertNotNull(result)
    }
}
