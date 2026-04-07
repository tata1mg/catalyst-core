package io.yourname.androidproject.camera

import android.graphics.RectF
import android.util.Log
import android.webkit.WebView
import org.json.JSONObject

/**
 * Pure coordinate math — no Android views, no bridge deps.
 * Converts JS viewfinder rect → screen-absolute rect.
 * Maps ML Kit barcode bounding box from image space → screen space.
 */
object ViewfinderMapper {

    private const val TAG = "ViewfinderMapper"

    /**
     * Parse viewfinder rect from JS JSON and convert to screen-absolute coordinates.
     * JS sends coords relative to WebView top-left; we add the WebView's on-screen origin.
     *
     * @return Pair(screenAbsoluteRect, jsRelativeRect) or null if parsing fails.
     */
    fun parseViewfinderRect(json: JSONObject, webView: WebView): Pair<RectF, RectF>? {
        return try {
            val x = json.getDouble("x").toFloat()
            val y = json.getDouble("y").toFloat()
            val w = json.getDouble("width").toFloat()
            val h = json.getDouble("height").toFloat()

            val jsRect = RectF(x, y, x + w, y + h)

            val loc = IntArray(2)
            webView.getLocationOnScreen(loc)
            val originX = loc[0].toFloat()
            val originY = loc[1].toFloat()

            val screenRect = RectF(x + originX, y + originY, x + originX + w, y + originY + h)
            Log.d(TAG, "viewfinderScreenRect: left=${screenRect.left} top=${screenRect.top} right=${screenRect.right} bottom=${screenRect.bottom}")
            Pair(screenRect, jsRect)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse viewfinderRect: ${e.message}")
            null
        }
    }

    /**
     * Map a barcode bounding box from ML Kit image space → screen space.
     *
     * ML Kit boxes are in post-rotation image space (after imgW/imgH swap).
     * PreviewView uses FILL_CENTER — compute uniform scale + center offset.
     */
    fun mapBarcodeToScreen(
        boxLeft: Int, boxTop: Int, boxRight: Int, boxBottom: Int,
        imageWidth: Int, imageHeight: Int,
        previewWidth: Float, previewHeight: Float
    ): RectF? {
        if (previewWidth == 0f || previewHeight == 0f) {
            Log.w(TAG, "previewView has zero size — cannot map barcode to screen")
            return null
        }
        val scale = maxOf(previewWidth / imageWidth.toFloat(), previewHeight / imageHeight.toFloat())
        val offsetX = (previewWidth - imageWidth * scale) / 2f
        val offsetY = (previewHeight - imageHeight * scale) / 2f
        return RectF(
            boxLeft   * scale + offsetX,
            boxTop    * scale + offsetY,
            boxRight  * scale + offsetX,
            boxBottom * scale + offsetY
        )
    }
}
