package io.yourname.androidproject.plugins.internal.preview

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ProcessGlobalConfig
import androidx.webkit.WebStorageCompat
import androidx.webkit.WebViewFeature

/**
 * Isolated, bridge-free browser surface for Preview and Docs modes.
 *
 * Trust boundary properties, by construction:
 * - Runs in the ':catalyst_preview' process with a unique WebView data
 *   directory suffix, so cookies/storage never touch the trusted WebView.
 * - No JavaScript interfaces are ever registered on this WebView.
 * - No Catalyst machinery is attached: no whitelist, caches, offline
 *   snapshotting, service-worker interception, or custom headers.
 * - HTTPS-only top-level navigation; all permission prompts denied;
 *   downloads, file chooser, and popups disabled.
 * - Browsing data is cleared before every session (survives process death)
 *   and again, best-effort, on close.
 */
class PreviewActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "PreviewActivity"

        const val EXTRA_URL = "preview.url"
        const val EXTRA_MODE = "preview.mode"
        const val EXTRA_EDGE_TO_EDGE = "preview.edgeToEdge"
        const val EXTRA_SPLASH_ENABLED = "preview.splash.enabled"
        const val EXTRA_SPLASH_BACKGROUND_COLOR = "preview.splash.backgroundColor"
        const val EXTRA_SPLASH_DURATION = "preview.splash.duration"

        private const val DATA_DIRECTORY_SUFFIX = "catalyst_preview"
        private const val MAX_RENDERER_RECOVERIES = 2
        private const val CLOSE_CLEAR_TIMEOUT_MS = 2000L

        // The suffix may be applied only once per process, before any
        // WebView/cookie API use. This activity is the only WebView user in
        // the ':catalyst_preview' process; keep it that way.
        @Volatile
        private var isolationApplied = false

        @Synchronized
        private fun ensureStorageIsolation(activity: Activity): Boolean {
            if (isolationApplied) {
                return true
            }
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    WebView.setDataDirectorySuffix(DATA_DIRECTORY_SUFFIX)
                } else if (
                    WebViewFeature.isStartupFeatureSupported(
                        activity,
                        WebViewFeature.STARTUP_FEATURE_SET_DATA_DIRECTORY_SUFFIX
                    )
                ) {
                    val config = ProcessGlobalConfig()
                    config.setDataDirectorySuffix(activity, DATA_DIRECTORY_SUFFIX)
                    ProcessGlobalConfig.apply(config)
                } else {
                    return false
                }
                isolationApplied = true
                true
            } catch (error: Exception) {
                Log.e(TAG, "Failed to apply WebView data directory suffix: ${error.message}")
                false
            }
        }
    }

    private var webView: WebView? = null
    private lateinit var webViewContainer: FrameLayout
    private lateinit var overlayBar: LinearLayout
    private lateinit var expandPill: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var titleView: TextView
    private lateinit var backButton: TextView
    private lateinit var forwardButton: TextView
    private lateinit var errorView: LinearLayout
    private lateinit var errorMessageView: TextView
    private var splashOverlay: FrameLayout? = null
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var closeRequested = false

    private lateinit var initialUrl: String
    private var initialHost: String = ""
    private var mode: String = PreviewPlugin.MODE_PREVIEW
    private var edgeToEdge = false
    private var currentUrl: String = ""
    private var rendererRecoveries = 0
    private var pageLoadedOnce = false
    private var splashShownAt = 0L
    private var splashDuration = 1000L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        initialUrl = intent.getStringExtra(EXTRA_URL).orEmpty()
        mode = intent.getStringExtra(EXTRA_MODE) ?: PreviewPlugin.MODE_PREVIEW
        edgeToEdge = intent.getBooleanExtra(EXTRA_EDGE_TO_EDGE, false)
        currentUrl = initialUrl
        initialHost = Uri.parse(initialUrl).host.orEmpty()

        if (initialUrl.isEmpty() || initialHost.isEmpty()) {
            finish()
            return
        }

        // Must run before the first WebView (or CookieManager) touch in this process.
        if (!ensureStorageIsolation(this)) {
            Toast.makeText(this, "Preview requires a newer Android System WebView", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        @SuppressLint("SourceLockedOrientationActivity")
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        WindowCompat.setDecorFitsSystemWindows(window, !edgeToEdge)

        setContentView(buildLayout())
        applyInsetHandling()
        setupBackNavigation()

        createWebView()
        showSplashIfConfigured()
        clearBrowsingData { loadCurrentUrl() }
    }

    // region UI construction (code-only: plugin sources must not need resource merging)

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    private fun buildLayout(): View {
        // Full-bleed frame: the WebView occupies the entire window (including
        // system-bar areas when edge-to-edge is on) so preview pages experience
        // the real viewport. Controls float above it and can collapse to a pill.
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#111318"))
        }

        webViewContainer = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.WHITE)
        }
        root.addView(webViewContainer)

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3))
        }

        overlayBar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
            )
        }
        overlayBar.addView(buildToolbar())
        overlayBar.addView(progressBar)
        root.addView(overlayBar)

        expandPill = TextView(this).apply {
            text = "⌄"
            contentDescription = "Show preview controls"
            setTextColor(Color.WHITE)
            textSize = 18f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#CC111318"))
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(dp(40), dp(40), Gravity.TOP or Gravity.END).apply {
                topMargin = dp(8)
                rightMargin = dp(8)
            }
            setOnClickListener {
                visibility = View.GONE
                overlayBar.visibility = View.VISIBLE
            }
        }
        root.addView(expandPill)

        errorView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = View.GONE
            setBackgroundColor(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        errorMessageView = TextView(this).apply {
            setTextColor(Color.parseColor("#333333"))
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(dp(24), 0, dp(24), dp(16))
        }
        errorView.addView(errorMessageView)
        errorView.addView(Button(this).apply {
            text = "Retry"
            setOnClickListener {
                errorView.visibility = View.GONE
                loadCurrentUrl()
            }
        })
        webViewContainer.addView(errorView)

        return root
    }

    private fun buildToolbar(): View {
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#E6111318"))
            setPadding(dp(4), dp(4), dp(4), dp(4))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        fun toolbarButton(glyph: String, description: String, onClick: () -> Unit): TextView {
            return TextView(this).apply {
                text = glyph
                contentDescription = description
                setTextColor(Color.WHITE)
                textSize = 20f
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
                setOnClickListener { onClick() }
            }
        }

        toolbar.addView(toolbarButton("✕", "Close preview") { closePreview() })

        backButton = toolbarButton("‹", "Back") { webView?.takeIf { it.canGoBack() }?.goBack() }
        forwardButton = toolbarButton("›", "Forward") { webView?.takeIf { it.canGoForward() }?.goForward() }
        toolbar.addView(backButton)
        toolbar.addView(forwardButton)

        titleView = TextView(this).apply {
            text = if (mode == PreviewPlugin.MODE_DOCS) "Catalyst Docs" else initialHost
            setTextColor(Color.WHITE)
            textSize = 14f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(8), 0, dp(8), 0)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        toolbar.addView(titleView)

        toolbar.addView(toolbarButton("⟳", "Reload") { webView?.reload() })
        toolbar.addView(toolbarButton("⌃", "Hide preview controls") {
            overlayBar.visibility = View.GONE
            expandPill.visibility = View.VISIBLE
        })

        return toolbar
    }

    private fun applyInsetHandling() {
        if (!edgeToEdge) {
            return
        }
        val root = findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            overlayBar.setPadding(0, bars.top, 0, 0)
            (expandPill.layoutParams as FrameLayout.LayoutParams).topMargin = dp(8) + bars.top
            insets
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = webView
                if (view != null && view.canGoBack()) {
                    view.goBack()
                } else {
                    closePreview()
                }
            }
        })
    }

    // endregion

    // region WebView lifecycle and hardening

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val view = WebView(this)
        view.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadsImagesAutomatically = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            setGeolocationEnabled(false)
        }

        view.webViewClient = buildWebViewClient()
        view.webChromeClient = buildWebChromeClient()
        view.setDownloadListener { _, _, _, _, _ ->
            Toast.makeText(this, "Downloads are disabled in preview", Toast.LENGTH_SHORT).show()
        }

        webView = view
        webViewContainer.addView(view, 0)
    }

    private fun buildWebViewClient(): WebViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val url = request?.url ?: return true
            // The external-open policy applies to main-frame navigations only;
            // subframes never get dialogs — they either load (https) or drop.
            val isMainFrame = request.isForMainFrame
            return when (url.scheme?.lowercase()) {
                "https" -> {
                    if (mode == PreviewPlugin.MODE_DOCS && isMainFrame && url.host != initialHost) {
                        confirmExternalOpen(url)
                        true
                    } else {
                        false
                    }
                }
                "tel", "mailto", "sms" -> {
                    if (isMainFrame) {
                        confirmExternalOpen(url)
                    }
                    true
                }
                else -> {
                    Log.w(TAG, "Blocked non-HTTPS navigation: ${url.scheme}")
                    true
                }
            }
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
            progressBar.visibility = View.VISIBLE
            url?.let { currentUrl = it }
            updateToolbarState()
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            progressBar.visibility = View.GONE
            pageLoadedOnce = true
            if (mode != PreviewPlugin.MODE_DOCS) {
                titleView.text = url?.let { Uri.parse(it).host } ?: initialHost
            }
            updateToolbarState()
            maybeDismissSplash()
        }

        override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: android.webkit.WebResourceError?
        ) {
            if (request?.isForMainFrame == true) {
                progressBar.visibility = View.GONE
                errorMessageView.text = "Could not load ${request.url?.host ?: "page"}"
                errorView.visibility = View.VISIBLE
                maybeDismissSplash()
            }
        }

        override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
            if (view !== webView) {
                return true
            }
            Log.w(TAG, "Preview renderer gone (crashed=${detail?.didCrash() ?: false}), recovering")
            teardownWebView()
            rendererRecoveries++
            if (rendererRecoveries > MAX_RENDERER_RECOVERIES) {
                Toast.makeText(this@PreviewActivity, "Preview stopped responding", Toast.LENGTH_LONG).show()
                closePreview()
                return true
            }
            createWebView()
            loadCurrentUrl()
            return true
        }
    }

    private fun buildWebChromeClient(): WebChromeClient = object : WebChromeClient() {
        override fun onProgressChanged(view: WebView?, newProgress: Int) {
            progressBar.progress = newProgress
        }

        override fun onReceivedTitle(view: WebView?, title: String?) {
            if (mode == PreviewPlugin.MODE_DOCS && !title.isNullOrBlank()) {
                titleView.text = title
            }
        }

        override fun onPermissionRequest(request: PermissionRequest?) {
            request?.deny()
        }

        override fun onGeolocationPermissionsShowPrompt(
            origin: String?,
            callback: GeolocationPermissions.Callback?
        ) {
            callback?.invoke(origin, false, false)
        }

        override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?
        ): Boolean {
            filePathCallback?.onReceiveValue(null)
            return true
        }
    }

    private fun teardownWebView() {
        val view = webView ?: return
        webView = null
        webViewContainer.removeView(view)
        try {
            view.destroy()
        } catch (error: Exception) {
            Log.w(TAG, "Error destroying preview WebView: ${error.message}")
        }
    }

    private fun updateToolbarState() {
        backButton.alpha = if (webView?.canGoBack() == true) 1f else 0.35f
        forwardButton.alpha = if (webView?.canGoForward() == true) 1f else 0.35f
    }

    private fun loadCurrentUrl() {
        webView?.loadUrl(currentUrl)
    }

    private fun confirmExternalOpen(url: Uri) {
        AlertDialog.Builder(this)
            .setTitle("Leave preview?")
            .setMessage("Open in another app:\n$url")
            .setPositiveButton("Open") { _, _ ->
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (error: ActivityNotFoundException) {
                    Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // endregion

    // region Session data lifecycle

    /**
     * Clears cookies, JS storage, and caches inside this isolated process.
     * Runs before every load (the primary invariant: it survives process
     * death, where the close-time clear never gets a chance to run) and
     * best-effort on close. Safe here precisely because this process owns a
     * dedicated data directory — the trusted shell's storage is untouchable.
     */
    private fun clearBrowsingData(onComplete: () -> Unit) {
        val webStorage = WebStorage.getInstance()
        CookieManager.getInstance().removeAllCookies {
            webStorage.deleteAllData()
            webView?.clearCache(true)
            webView?.clearHistory()
            webView?.clearFormData()
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
                try {
                    WebStorageCompat.deleteBrowsingData(webStorage) { runOnUiThread(onComplete) }
                    return@removeAllCookies
                } catch (error: Exception) {
                    Log.w(TAG, "deleteBrowsingData failed, classic clears already ran: ${error.message}")
                }
            }
            runOnUiThread(onComplete)
        }
    }

    /**
     * User-initiated close: await the data clear (bounded) before destroying
     * the WebView and finishing. Clear-before-load remains the primary
     * invariant for the cases where this never runs (process death).
     */
    private fun closePreview() {
        if (closeRequested) {
            return
        }
        closeRequested = true
        val timeout = Runnable {
            teardownWebView()
            finish()
        }
        mainHandler.postDelayed(timeout, CLOSE_CLEAR_TIMEOUT_MS)
        clearBrowsingData {
            mainHandler.removeCallbacks(timeout)
            teardownWebView()
            finish()
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        if (!closeRequested && webView != null) {
            // System-initiated destroy: best-effort clear only.
            clearBrowsingData {}
        }
        teardownWebView()
        super.onDestroy()
    }

    // endregion

    // region Splash

    private fun showSplashIfConfigured() {
        if (!intent.getBooleanExtra(EXTRA_SPLASH_ENABLED, false)) {
            return
        }
        splashDuration = intent.getLongExtra(EXTRA_SPLASH_DURATION, 1000L).coerceIn(0L, 10_000L)
        val backgroundColor = try {
            Color.parseColor(intent.getStringExtra(EXTRA_SPLASH_BACKGROUND_COLOR) ?: "#ffffff")
        } catch (error: IllegalArgumentException) {
            Color.WHITE
        }

        splashOverlay = FrameLayout(this).apply {
            setBackgroundColor(backgroundColor)
            isClickable = true
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        webViewContainer.addView(splashOverlay)
        splashShownAt = SystemClock.elapsedRealtime()
        webViewContainer.postDelayed({ maybeDismissSplash() }, splashDuration)
    }

    private fun maybeDismissSplash() {
        val overlay = splashOverlay ?: return
        val elapsed = SystemClock.elapsedRealtime() - splashShownAt
        if (!pageLoadedOnce && errorView.visibility != View.VISIBLE) {
            return
        }
        if (elapsed < splashDuration) {
            webViewContainer.postDelayed({ maybeDismissSplash() }, splashDuration - elapsed)
            return
        }
        splashOverlay = null
        overlay.animate().alpha(0f).setDuration(200L).withEndAction {
            webViewContainer.removeView(overlay)
        }.start()
    }

    // endregion
}
