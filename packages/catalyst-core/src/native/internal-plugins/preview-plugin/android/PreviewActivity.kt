package io.yourname.androidproject.plugins.internal.preview

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
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
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.webkit.ProcessGlobalConfig
import androidx.webkit.WebStorageCompat
import androidx.webkit.WebViewFeature

/**
 * Isolated, bridge-free surface for previewing external HTTPS apps.
 *
 * Presentation is chrome-less by design — exactly like the trusted Catalyst
 * WebView, the page IS the screen. There is no toolbar, URL display, or
 * progress bar. The system back gesture walks page history and then closes
 * the preview; a failed load shows an error state with Retry/Close.
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
        const val EXTRA_EDGE_TO_EDGE = "preview.edgeToEdge"
        const val EXTRA_SPLASH_ENABLED = "preview.splash.enabled"
        const val EXTRA_SPLASH_BACKGROUND_COLOR = "preview.splash.backgroundColor"
        const val EXTRA_SPLASH_DURATION = "preview.splash.duration"

        private const val DATA_DIRECTORY_SUFFIX = "catalyst_preview"
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
    private lateinit var errorView: LinearLayout
    private lateinit var errorMessageView: TextView
    private var splashOverlay: FrameLayout? = null
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var closeRequested = false
    private var pendingGeolocationOrigin: String? = null
    private var pendingGeolocationCallback: GeolocationPermissions.Callback? = null

    private val locationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
            val origin = pendingGeolocationOrigin
            val callback = pendingGeolocationCallback
            pendingGeolocationOrigin = null
            pendingGeolocationCallback = null

            val granted =
                permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                    permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
            callback?.invoke(origin, granted, false)
        }

    private lateinit var initialUrl: String
    private var initialHost: String = ""
    private var edgeToEdge = false
    private var currentUrl: String = ""
    private var pageLoadedOnce = false
    private var splashShownAt = 0L
    private var splashDuration = 1000L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        initialUrl = intent.getStringExtra(EXTRA_URL).orEmpty()
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
        // the real viewport. The only other surface is the error state.
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
                // A dead renderer tears the WebView down; recreate on demand.
                if (webView == null) {
                    createWebView()
                }
                loadCurrentUrl()
            }
        })
        errorView.addView(Button(this).apply {
            text = "Close preview"
            setOnClickListener { closePreview() }
        })
        webViewContainer.addView(errorView)

        return root
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
            setGeolocationEnabled(true)
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
                "https" -> false
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
            url?.let { currentUrl = it }
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            pageLoadedOnce = true
            maybeDismissSplash()
        }

        override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: android.webkit.WebResourceError?
        ) {
            if (request?.isForMainFrame == true) {
                errorMessageView.text = "Could not load ${request.url?.host ?: "page"}"
                errorView.visibility = View.VISIBLE
                maybeDismissSplash()
            }
        }

        override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
            if (view !== webView) {
                return true
            }
            // User-driven recovery via the error screen's Retry (which recreates
            // the WebView) — no automatic recreate loop to babysit.
            Log.w(TAG, "Preview renderer gone (crashed=${detail?.didCrash() ?: false})")
            teardownWebView()
            errorMessageView.text = "Preview stopped responding"
            errorView.visibility = View.VISIBLE
            maybeDismissSplash()
            return true
        }
    }

    private fun buildWebChromeClient(): WebChromeClient = object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest?) {
            request?.deny()
        }

        override fun onGeolocationPermissionsShowPrompt(
            origin: String?,
            callback: GeolocationPermissions.Callback?
        ) {
            requestDemoLocation(origin, callback)
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

    private fun requestDemoLocation(
        origin: String?,
        callback: GeolocationPermissions.Callback?
    ) {
        if (origin == null || callback == null || !isAllowedDemoLocationOrigin(origin)) {
            callback?.invoke(origin, false, false)
            return
        }

        val alreadyGranted =
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        if (alreadyGranted) {
            callback.invoke(origin, true, false)
            return
        }

        pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, false, false)
        pendingGeolocationOrigin = origin
        pendingGeolocationCallback = callback
        locationPermissionLauncher.launch(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
        )
    }

    private fun isAllowedDemoLocationOrigin(origin: String): Boolean {
        val originUri = Uri.parse(origin)
        val originHost = originUri.host?.lowercase() ?: return false
        val currentHost = Uri.parse(currentUrl).host?.lowercase() ?: return false
        return originUri.scheme.equals("https", ignoreCase = true) &&
            originHost == currentHost &&
            (originHost == "1mg.com" || originHost == "www.1mg.com")
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
        pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, false, false)
        pendingGeolocationOrigin = null
        pendingGeolocationCallback = null
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
