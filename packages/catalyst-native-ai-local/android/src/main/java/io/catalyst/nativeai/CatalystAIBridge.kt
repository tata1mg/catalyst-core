package io.catalyst.nativeai

import android.app.Activity
import android.webkit.WebView
import io.yourname.androidproject.AIBridge
import io.yourname.androidproject.utils.BridgeUtils
import io.yourname.androidproject.utils.FrameworkServerUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * AIBridge implementation shipped by @catalyst/native-ai-local.
 * Self-registers via ServiceLoader — catalyst-core has zero knowledge of this class.
 *
 * ServiceLoader requires a no-arg constructor, so Activity/WebView are injected
 * lazily via attach() called from NativeBridge after ServiceLoader discovery.
 */
class CatalystAIBridge : AIBridge {

    private var activity: Activity? = null
    private var webView: WebView? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private var aiModule: NativeBridgeAI? = null

    // Called by NativeBridge immediately after ServiceLoader.load().firstOrNull()
    override fun attach(activity: Activity, webView: WebView) {
        this.activity = activity
        this.webView = webView
    }

    override fun initAI(optionsRaw: String?) {
        val act = activity ?: return
        val wv = webView ?: return

        if (!FrameworkServerUtils.isRunning()) {
            BridgeUtils.notifyWebError(
                wv,
                BridgeUtils.WebEvents.ON_AI_ERROR,
                "FrameworkServer not running — cannot expose AI stream"
            )
            return
        }

        val ai = aiModule ?: NativeBridgeAI(
            context = act,
            onLog = { msg ->
                val payload = JSONObject().apply { put("message", msg) }
                BridgeUtils.notifyWebJson(wv, BridgeUtils.WebEvents.ON_AI_LOG, payload)
            },
            onProgress = { phase, percent, bytesLoaded, bytesTotal, detail ->
                val payload = JSONObject().apply {
                    put("phase", phase)
                    put("percent", percent)
                    put("bytesLoaded", bytesLoaded)
                    put("bytesTotal", bytesTotal)
                    put("detail", detail)
                }
                BridgeUtils.notifyWebJson(wv, BridgeUtils.WebEvents.ON_AI_PROGRESS, payload)
            }
        ).also { aiModule = it }

        scope.launch(Dispatchers.IO) {
            when (val result = ai.init(optionsRaw)) {
                is InitResult.AlreadyRunning -> { /* duplicate call, ignore */ }
                is InitResult.Ready -> {
                    FrameworkServerUtils.setNativeAiSupplier(result.streamSupplier)
                    FrameworkServerUtils.setNativeSystemPrompt(result.systemPrompt)

                    val port = FrameworkServerUtils.getServerPort()
                    val sessionId = FrameworkServerUtils.getSessionId()
                    val streamUrl = "http://localhost:$port/framework-$sessionId/ai/stream"

                    BridgeUtils.notifyWeb(
                        wv,
                        BridgeUtils.WebEvents.ON_AI_READY,
                        """{"url":"$streamUrl","port":$port,"sessionId":"$sessionId"}"""
                    )
                }
                is InitResult.Error -> {
                    BridgeUtils.notifyWebError(
                        wv,
                        BridgeUtils.WebEvents.ON_AI_ERROR,
                        "Failed to load native AI model: ${result.cause.message}"
                    )
                }
            }
        }
    }

    override fun generateNative(optionsRaw: String?) {
        // generateNative re-uses the same init path — model is already loaded,
        // NativeBridgeAI.init() returns InitResult.AlreadyRunning if engine is warm.
        initAI(optionsRaw)
    }

    override fun clearConversation() {
        aiModule?.clearConversation()
    }
}
