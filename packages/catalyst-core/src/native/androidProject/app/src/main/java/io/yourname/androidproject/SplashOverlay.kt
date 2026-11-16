package io.yourname.androidproject

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import io.yourname.androidproject.databinding.ActivitySplashBinding
import java.util.Properties

/**
 * HTML splash shown above the main WebView until its first page finishes,
 * held for at least splashScreen.minDuration ms and capped at MAX_DURATION_MS.
 */
class SplashOverlay(private val activity: Activity, private val properties: Properties) {

    companion object {
        private const val MAX_DURATION_MS = 10_000L
        private const val FADE_DURATION_MS = 300L
    }

    private val handler = Handler(Looper.getMainLooper())
    private val minDuration = properties.getProperty("splashScreen.minDuration")?.toLongOrNull() ?: 0
    private var root: FrameLayout? = null
    private var webView: WebView? = null
    private var shownAt = 0L
    private var dismissed = false

    @SuppressLint("SetJavaScriptEnabled")
    fun show() {
        val splashBinding = ActivitySplashBinding.inflate(activity.layoutInflater)
        configureSplashScreen(activity, splashBinding, properties)

        // No JS interfaces; only the bundled asset may load
        val splashWebView = WebView(activity).apply {
            settings.javaScriptEnabled = true
            settings.blockNetworkLoads = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            setBackgroundColor(Color.TRANSPARENT)
            // Chromium paints the page background before its content, so keep the native image
            // in view until the HTML's first frame with content is on screen
            alpha = 0f
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) {
                    view.postVisualStateCallback(0, object : WebView.VisualStateCallback() {
                        override fun onComplete(requestId: Long) {
                            view.alpha = 1f
                        }
                    })
                }
            }
            loadUrl("file:///android_asset/${SplashActivity.HTML_SPLASH_ASSET}")
        }
        val matchParent = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        val overlayRoot = FrameLayout(activity).apply {
            addView(splashBinding.root, matchParent)
            addView(splashWebView, matchParent)
            // Swallow touches so they don't reach the main WebView underneath
            isClickable = true
            isFocusable = true
        }

        activity.addContentView(overlayRoot, matchParent)

        root = overlayRoot
        webView = splashWebView
        shownAt = SystemClock.elapsedRealtime()
        handler.postDelayed({ dismiss() }, MAX_DURATION_MS)
    }

    fun onMainPageLoaded() {
        if (dismissed) return
        val remaining = minDuration - (SystemClock.elapsedRealtime() - shownAt)
        handler.postDelayed({ dismiss() }, remaining.coerceAtLeast(0))
    }

    private fun dismiss() {
        if (dismissed) return
        dismissed = true
        handler.removeCallbacksAndMessages(null)
        val overlayRoot = root ?: return
        overlayRoot.animate()
            .alpha(0f)
            .setDuration(FADE_DURATION_MS)
            .withEndAction { destroy() }
            .start()
    }

    fun release() {
        dismissed = true
        handler.removeCallbacksAndMessages(null)
        root?.animate()?.cancel()
        destroy()
    }

    private fun destroy() {
        val overlayRoot = root ?: return
        (overlayRoot.parent as? ViewGroup)?.removeView(overlayRoot)
        webView?.destroy()
        webView = null
        root = null
    }
}
