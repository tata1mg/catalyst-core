package io.yourname.androidproject.plugins.internal.companion

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.google.android.material.bottomsheet.BottomSheetDialog
import io.yourname.androidproject.MainActivity
import io.yourname.androidproject.CompanionUrlPolicy
import io.yourname.androidproject.plugins.CatalystPlugin
import io.yourname.androidproject.plugins.PluginBridgeContext
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sqrt

class CompanionPlugin : CatalystPlugin {

    companion object {
        private const val TAG = "CompanionPlugin"
        private const val OPEN = "openPreview"
        private const val OPENED = "onPreviewOpened"
        private const val ERROR = "onPreviewError"
        private const val CANCELLED = "PREVIEW_CANCELLED"
        private const val FAILED = "PREVIEW_FAILED"
        private const val BANNER_TEXT = "Catalyst Companion · Preview"
        private const val RESOLVE_MIN_MS = 550L

        private val requestInFlight = AtomicBoolean(false)
        private val fetchExecutor = Executors.newSingleThreadExecutor { task ->
            Thread(task, "catalyst-companion-preview").apply { isDaemon = true }
        }

        private var activity: MainActivity? = null
        private var banner: View? = null
        private var exitDialog: BottomSheetDialog? = null
        private var resolvingOverlay: View? = null
        private var lifecycleObserver: DefaultLifecycleObserver? = null
        private var sensorManager: SensorManager? = null
        private var shakeListener: SensorEventListener? = null
        private var lastShakeAt = 0L
        @Volatile
        private var previewUrl: String? = null
    }

    override fun handle(command: String, data: JSONObject?, bridge: PluginBridgeContext) {
        if (command != OPEN) {
            sendError(bridge, "Unsupported command: $command", "UNSUPPORTED_COMMAND")
            return
        }
        if (previewUrl != null) {
            sendError(bridge, "Exit the current preview before opening another", "PREVIEW_ACTIVE")
            return
        }

        val host = bridge.activity as? MainActivity
        val parsed = data?.optString("url")?.trim()?.takeIf(String::isNotEmpty)?.let(Uri::parse)
        if (host == null || parsed == null) {
            sendError(bridge, "A valid URL is required", "INVALID_URL")
            return
        }
        if (!CompanionUrlPolicy.isAllowed(parsed)) {
            sendError(
                bridge,
                "Preview requires https, or http on a private-network address",
                "UNSUPPORTED_HOST"
            )
            return
        }
        if (!requestInFlight.compareAndSet(false, true)) {
            sendError(bridge, "A preview request is already open", FAILED)
            return
        }

        val url = if (parsed.encodedPath.isNullOrEmpty()) {
            parsed.buildUpon().encodedPath("/").build().toString()
        } else {
            parsed.toString()
        }
        val origin = CompanionPreviewConfig.originOf(Uri.parse(url))
        // The QR resolves instantly, so without this the screen sits dead until
        // the confirm dialog appears and the scan feels like it did nothing.
        showResolving(host, origin)
        val startedAt = System.currentTimeMillis()
        fetchExecutor.execute {
            val config = CompanionPreviewConfig.fetch(origin)
            // Hold the indicator briefly so a fast fetch still reads as a step
            // rather than a flash.
            val elapsed = System.currentTimeMillis() - startedAt
            if (elapsed < RESOLVE_MIN_MS) Thread.sleep(RESOLVE_MIN_MS - elapsed)
            host.runOnUiThread {
                dismissResolving()
                if (host.isFinishing || host.isDestroyed) {
                    requestInFlight.set(false)
                } else {
                    try {
                        showConfirm(host, bridge, url, origin, config)
                    } catch (error: Exception) {
                        requestInFlight.set(false)
                        sendError(bridge, error.message ?: "Failed to open preview", FAILED)
                    }
                }
            }
        }
    }

    /** Full-screen scrim with a spinner, shown while the runtime config loads. */
    private fun showResolving(host: MainActivity, origin: String) {
        if (host.isFinishing || host.isDestroyed) return
        dismissResolving()
        val overlay = LinearLayout(host).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.argb(0xE6, 0x0D, 0x0D, 0x16))
            isClickable = true
            addView(android.widget.ProgressBar(host).apply {
                isIndeterminate = true
                layoutParams = LinearLayout.LayoutParams(dp(host, 44), dp(host, 44))
            })
            addView(TextView(host).apply {
                text = "Opening preview…"
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(host, 18) }
            })
            addView(TextView(host).apply {
                text = origin
                setTextColor(Color.argb(0xA0, 0xFF, 0xFF, 0xFF))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(host, 6) }
            })
            alpha = 0f
            animate().alpha(1f).setDuration(160).start()
        }
        host.addContentView(
            overlay,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        resolvingOverlay = overlay
    }

    private fun dismissResolving() {
        val overlay = resolvingOverlay ?: return
        resolvingOverlay = null
        (overlay.parent as? ViewGroup)?.removeView(overlay)
    }

    private fun showConfirm(
        host: MainActivity,
        bridge: PluginBridgeContext,
        url: String,
        origin: String,
        config: JSONObject?
    ) {
        val message = if (config != null) {
            "Origin: $origin\nRuntime config: loaded\n\n" +
                "The loaded app receives full native bridge access."
        } else {
            "No compatible runtime config was found for:\n$origin\n\n" +
                "Companion defaults will be used and the loaded app receives full native bridge access."
        }

        AlertDialog.Builder(host)
            .setTitle("Open preview?")
            .setMessage(message)
            .setNegativeButton("Cancel") { _, _ ->
                sendError(bridge, "Preview cancelled", CANCELLED)
            }
            .setPositiveButton("Open Preview") { _, _ ->
                openPreview(host, bridge, url, origin, config)
            }
            .setOnCancelListener {
                sendError(bridge, "Preview cancelled", CANCELLED)
            }
            .create()
            .apply {
                setOnDismissListener { requestInFlight.set(false) }
                show()
            }
    }

    private fun openPreview(
        host: MainActivity,
        bridge: PluginBridgeContext,
        url: String,
        origin: String,
        config: JSONObject?
    ) {
        try {
            val properties = CompanionPreviewConfig.toPropertyMap(config).toMutableMap()
            if (properties["accessControl.enabled"].toBoolean()) {
                val originPattern = "$origin/*"
                val allowedUrls = properties["accessControl.allowedUrls"]
                    .orEmpty()
                    .split(",")
                    .map(String::trim)
                    .filter(String::isNotEmpty)
                properties["accessControl.allowedUrls"] =
                    (allowedUrls + originPattern).distinct().joinToString(",")
            }
            previewUrl = url
            bridge.callback(OPENED, JSONObject().put("url", url))
            host.restartWithRuntimeConfig(
                properties,
                url,
                ::attachChrome
            )
        } catch (error: Exception) {
            Log.e(TAG, "Failed to open preview", error)
            previewUrl = null
            detachChrome()
            sendError(bridge, error.message ?: "Failed to open preview", FAILED)
        }
    }

    private fun attachChrome(host: MainActivity) {
        detachChrome()
        activity = host

        val wrapper = FrameLayout(host).apply {
            isClickable = false
            isFocusable = false
        }
        val strip = TextView(host).apply {
            text = BANNER_TEXT
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.argb(0xD8, 0x11, 0x11, 0x13))
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            isClickable = true
            contentDescription = "$BANNER_TEXT. Tap for preview options."
            setOnClickListener { showExitSheet(host) }
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                dp(host, 30),
                Gravity.TOP
            )
        }
        wrapper.addView(strip)

        fun positionBelowStatusBar() {
            val topInset = ViewCompat.getRootWindowInsets(host.window.decorView)
                ?.getInsets(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout())
                ?.top ?: 0
            val contentLocation = IntArray(2)
            host.findViewById<View>(android.R.id.content)?.getLocationOnScreen(contentLocation)
            (strip.layoutParams as FrameLayout.LayoutParams).apply {
                topMargin = (topInset - contentLocation[1]).coerceAtLeast(0)
            }
            strip.requestLayout()
        }

        ViewCompat.setOnApplyWindowInsetsListener(wrapper) { _, insets ->
            positionBelowStatusBar()
            insets
        }
        host.addContentView(
            wrapper,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        banner = wrapper
        host.setBackPressInterceptor {
            showExitSheet(host)
            true
        }
        observeLifecycle(host)
        positionBelowStatusBar()
        ViewCompat.requestApplyInsets(wrapper)
    }

    private fun showExitSheet(host: MainActivity) {
        if (host.isFinishing || host.isDestroyed || exitDialog?.isShowing == true) return
        val dialog = BottomSheetDialog(host)
        val content = LinearLayout(host).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(host, 20), dp(host, 10), dp(host, 20), dp(host, 28))
            background = sheetBackground(host)

            // Grab handle — the affordance that says "this is a sheet".
            addView(View(host).apply {
                setBackgroundColor(Color.argb(0x40, 0xFF, 0xFF, 0xFF))
                layoutParams = LinearLayout.LayoutParams(dp(host, 36), dp(host, 4)).apply {
                    gravity = Gravity.CENTER_HORIZONTAL
                    bottomMargin = dp(host, 18)
                }
            })

            addView(TextView(host).apply {
                text = "Preview running"
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
            })
            addView(TextView(host).apply {
                text = previewUrl ?: BANNER_TEXT
                setTextColor(Color.argb(0xB0, 0xFF, 0xFF, 0xFF))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(host, 4); bottomMargin = dp(host, 22) }
            })

            addAction(host, "Reload preview", primary = true) {
                dialog.dismiss()
                previewUrl?.let(host::replaceUrlThroughWebView)
            }
            addAction(host, "Exit preview", destructive = true) {
                dialog.dismiss()
                exitPreview(host)
            }
            addAction(host, "Cancel") { dialog.dismiss() }
        }
        dialog.setContentView(content)
        // The sheet paints its own rounded dark background; clear the default
        // window backing so the corners are not squared off by a grey plate.
        (content.parent as? View)?.setBackgroundColor(Color.TRANSPARENT)
        dialog.setOnDismissListener { exitDialog = null }
        exitDialog = dialog
        dialog.show()
    }

    /** Rounded dark surface for the sheet, drawn top-corners-only. */
    private fun sheetBackground(host: Context) =
        android.graphics.drawable.GradientDrawable().apply {
            setColor(Color.argb(0xFF, 0x18, 0x18, 0x22))
            val r = dp(host, 22).toFloat()
            cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
        }

    private fun LinearLayout.addAction(
        host: MainActivity,
        label: String,
        primary: Boolean = false,
        destructive: Boolean = false,
        action: () -> Unit
    ) {
        addView(Button(host).apply {
            text = label
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            stateListAnimator = null
            setTextColor(
                when {
                    primary -> Color.WHITE
                    destructive -> Color.rgb(0xFF, 0x6B, 0x6B)
                    else -> Color.argb(0xC8, 0xFF, 0xFF, 0xFF)
                }
            )
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(host, 14).toFloat()
                when {
                    primary -> setColor(Color.rgb(0x71, 0x71, 0xFF))
                    else -> {
                        setColor(Color.argb(0x14, 0xFF, 0xFF, 0xFF))
                        setStroke(dp(host, 1), Color.argb(0x1F, 0xFF, 0xFF, 0xFF))
                    }
                }
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(host, 52)
            ).apply { bottomMargin = dp(host, 10) }
            setOnClickListener { action() }
        })
    }

    private fun observeLifecycle(host: MainActivity) {
        val observer = object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) = startShakeDetection(host)
            override fun onPause(owner: LifecycleOwner) = stopShakeDetection()
            override fun onDestroy(owner: LifecycleOwner) {
                if (!host.isChangingConfigurations) {
                    previewUrl = null
                    host.abandonRuntimeConfig()
                }
                dismissResolving()
                detachChrome()
            }
        }
        lifecycleObserver = observer
        host.lifecycle.addObserver(observer)
        if (host.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            startShakeDetection(host)
        }
    }

    private fun startShakeDetection(host: MainActivity) {
        if (shakeListener != null) return
        val manager = host.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
        val accelerometer = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        val listener = object : SensorEventListener {
            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

            override fun onSensorChanged(event: SensorEvent) {
                val gravity = SensorManager.GRAVITY_EARTH
                val force = sqrt(
                    event.values[0] * event.values[0] +
                        event.values[1] * event.values[1] +
                        event.values[2] * event.values[2]
                ) / gravity
                val now = System.currentTimeMillis()
                if (force > 2.7f && now - lastShakeAt > 1_000) {
                    lastShakeAt = now
                    showExitSheet(host)
                }
            }
        }
        sensorManager = manager
        shakeListener = listener
        manager.registerListener(listener, accelerometer, SensorManager.SENSOR_DELAY_UI)
    }

    private fun stopShakeDetection() {
        shakeListener?.let { sensorManager?.unregisterListener(it) }
        shakeListener = null
        sensorManager = null
    }

    private fun exitPreview(host: MainActivity) {
        previewUrl = null
        host.clearRuntimeConfig()
    }

    private fun detachChrome() {
        exitDialog?.dismiss()
        exitDialog = null
        stopShakeDetection()
        lifecycleObserver?.let { observer -> activity?.lifecycle?.removeObserver(observer) }
        lifecycleObserver = null
        activity?.setBackPressInterceptor(null)
        banner?.let { view -> (view.parent as? ViewGroup)?.removeView(view) }
        banner = null
        activity = null
    }

    private fun dp(context: Context, value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            context.resources.displayMetrics
        ).toInt()

    private fun sendError(bridge: PluginBridgeContext, message: String, code: String) {
        bridge.callback(ERROR, JSONObject().put("message", message).put("code", code))
    }
}
