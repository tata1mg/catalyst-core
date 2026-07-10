package io.catalyst.nativeai

import android.app.Activity
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * AIBridge implementation shipped by @catalyst/cloud-ai.
 * Self-registers via ServiceLoader — catalyst-core has zero knowledge of this class.
 *
 * ServiceLoader requires a no-arg constructor, so Activity/WebView/callbacks are injected
 * lazily via attach() called from NativeBridge after ServiceLoader discovery.
 */
class CatalystAIBridge : AIBridge {

    private var activity: Activity? = null
    private var webView: WebView? = null
    private var callbacks: AIBridgeCallbacks? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private var aiModule: NativeBridgeAI? = null

    override fun attach(activity: Activity, webView: WebView, callbacks: AIBridgeCallbacks) {
        this.activity = activity
        this.webView = webView
        this.callbacks = callbacks
    }

    override fun initAI(optionsRaw: String?) {
        val act = activity ?: return
        val cb = callbacks ?: return

        if (!cb.isFrameworkServerRunning()) {
            cb.onError("FrameworkServer not running — cannot expose AI stream")
            return
        }

        val ai = aiModule ?: NativeBridgeAI(
            context = act,
            onLog = { msg -> cb.onLog(msg) },
            onProgress = { phase, percent, bytesLoaded, bytesTotal, detail ->
                cb.onProgress(phase, percent, bytesLoaded, bytesTotal, detail)
            }
        ).also { aiModule = it }

        scope.launch(Dispatchers.IO) {
            when (val result = ai.init(optionsRaw)) {
                is InitResult.AlreadyRunning -> { /* duplicate call, ignore */ }
                is InitResult.Ready -> {
                    cb.setNativeAiSupplier(result.streamSupplier)
                    cb.setNativeSystemPrompt(result.systemPrompt)

                    val port = cb.getFrameworkServerPort()
                    val sessionId = cb.getFrameworkServerSessionId()
                    cb.onReady(
                        streamUrl = "http://localhost:$port/framework-$sessionId/ai/stream",
                        port = port,
                        sessionId = sessionId
                    )
                }
                is InitResult.Error -> {
                    cb.onError("Failed to load native AI model: ${result.cause.message}")
                }
            }
        }
    }

    override fun generateNative(optionsRaw: String?) {
        initAI(optionsRaw)
    }

    override fun clearConversation() {
        aiModule?.clearConversation()
    }
}
