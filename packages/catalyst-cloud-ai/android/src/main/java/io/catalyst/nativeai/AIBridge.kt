package io.catalyst.nativeai

import android.app.Activity
import android.webkit.WebView

interface AIBridge {
    fun attach(activity: Activity, webView: WebView, callbacks: AIBridgeCallbacks)
    fun initAI(optionsRaw: String?)
    fun generateNative(optionsRaw: String?)
    fun clearConversation()
}

/** Callbacks provided by the host app — decouples catalyst-cloud-ai from app internals. */
interface AIBridgeCallbacks {
    fun onReady(streamUrl: String, port: Int, sessionId: String)
    fun onProgress(phase: String, percent: Int, bytesLoaded: Long, bytesTotal: Long, detail: String)
    fun onLog(message: String)
    fun onError(message: String)
    fun isFrameworkServerRunning(): Boolean
    fun getFrameworkServerPort(): Int
    fun getFrameworkServerSessionId(): String
    fun setNativeAiSupplier(supplier: Any?)
    fun setNativeSystemPrompt(prompt: String)
}
