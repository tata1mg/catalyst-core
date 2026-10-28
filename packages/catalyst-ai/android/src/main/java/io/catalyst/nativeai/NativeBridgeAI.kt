package io.catalyst.nativeai

import android.content.Context
import android.util.Log
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * All LiteRT-LM logic extracted from NativeBridge so catalyst-core has zero LiteRT imports.
 *
 * Usage (from the withAI source-set glue in the app):
 *   val ai = NativeBridgeAI(context, onLog, onProgress)
 *   ai.init(optionsJson)                          // downloads model + wires supplier
 *   FrameworkServerUtils.setNativeAiSupplier(ai::supply)
 *   FrameworkServerUtils.setNativeSystemPrompt(ai.systemPrompt)
 */
class NativeBridgeAI(
    private val context: Context,
    private val onLog: (String) -> Unit,
    private val onProgress: (phase: String, percent: Int, bytesLoaded: Long, bytesTotal: Long, detail: String) -> Unit,
) {
    private val TAG = "NativeBridgeAI"

    private var engine: Engine? = null
    private val isInitializing = AtomicBoolean(false)

    private var nativeConversation: Conversation? = null
    private var nativeConversationId: String? = null

    var systemPrompt: String = ""
        private set

    private val MODEL_REGISTRY = mapOf(
        "gemma-4-E2B" to ModelEntry(
            url = "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm",
            filename = "gemma-4-E2B-it.litertlm",
            sizeHint = 2_588_147_712L
        ),
        "qwen3-0.6B" to ModelEntry(
            url = "https://huggingface.co/litert-community/Qwen3-0.6B-it-litert-lm/resolve/main/Qwen3-0.6B-it-int4.litertlm",
            filename = "Qwen3-0.6B-it-int4.litertlm",
            sizeHint = 474_000_000L
        ),
    )

    data class ModelEntry(val url: String, val filename: String, val sizeHint: Long)

    /**
     * Returns false if init was already in progress (duplicate guard).
     * Caller is responsible for running this on a background thread (Dispatchers.IO).
     */
    suspend fun init(optionsRaw: String?): InitResult {
        if (!isInitializing.compareAndSet(false, true)) {
            return InitResult.AlreadyRunning
        }
        return try {
            val options = try { JSONObject(optionsRaw ?: "{}") } catch (e: Exception) { JSONObject() }

            buildSystemPrompt(options)

            val modelPath = resolveModel(options)
            ensureEngine(modelPath)

            InitResult.Ready(
                streamSupplier = ::supply,
                systemPrompt = systemPrompt,
            )
        } catch (e: Exception) {
            InitResult.Error(e)
        } finally {
            isInitializing.set(false)
        }
    }

    fun clearConversation() {
        nativeConversation = null
        nativeConversationId = null
        log("Native conversation cleared — next call starts a fresh session")
    }

    // Called by FrameworkServerUtils supplier lambda
    suspend fun supply(prompt: String, genConfig: JSONObject, incomingConvId: String?): Pair<String, Flow<String>> {
        val eng = engine ?: throw IllegalStateException("Engine not initialized — call init() first")

        val conversation = if (
            incomingConvId != null &&
            incomingConvId == nativeConversationId &&
            nativeConversation != null
        ) {
            log("Native session: reusing conversation $incomingConvId")
            nativeConversation!!
        } else {
            log("Native session: creating new conversation")
            val newConv = eng.createConversation(ConversationConfig())
            nativeConversation = newConv
            nativeConversationId = UUID.randomUUID().toString()
            newConv
        }

        val activeConvId = nativeConversationId!!
        val tokenFlow = conversation.sendMessageAsync(prompt).map { message ->
            message.contents.contents
                .filterIsInstance<Content.Text>()
                .joinToString("") { it.text }
        }
        return Pair(activeConvId, tokenFlow)
    }

    // -------------------------------------------------------------------------
    // Private
    // -------------------------------------------------------------------------

    private fun buildSystemPrompt(options: JSONObject) {
        val attachmentComponents = options.optJSONObject("attachmentComponents")
        if (attachmentComponents == null || attachmentComponents.length() == 0) {
            // No components to describe, but the app's own systemPrompt must still reach the model.
            systemPrompt = options.optString("systemPrompt", "").trim()
            log("[attachments] No attachmentComponents provided — using the app systemPrompt only (${systemPrompt.length} chars)")
            return
        }

        log("[attachments] Received ${attachmentComponents.length()} component(s): ${attachmentComponents.keys().asSequence().joinToString()}")
        val appSystemPrompt = options.optString("systemPrompt", "").trim()
        val sb = StringBuilder()
        if (appSystemPrompt.isNotBlank()) {
            sb.appendLine(appSystemPrompt)
            sb.appendLine()
        }
        sb.appendLine("Never use markdown headers, bullet points, numbered lists, or bold. Instead use these components: <tool:create_attachment component='Name' [attr='val']>body</tool:create_attachment>")
        sb.append("Available components: ")
        val componentSummary = attachmentComponents.keys().asSequence().map { name ->
            val def = attachmentComponents.optJSONObject(name)
            val hint = def?.optString("hint", "")?.trim() ?: ""
            if (hint.isNotBlank()) "$name ($hint)" else name
        }.joinToString(", ")
        sb.appendLine(componentSummary)
        attachmentComponents.keys().forEach { name -> log("[attachments] Registered component: $name") }
        systemPrompt = sb.toString().trim()
        log("[attachments] System prompt set (${systemPrompt.length} chars)")
    }

    private fun resolveModel(options: JSONObject): String {
        val explicitPath = options.optString("modelPath", "")
        if (explicitPath.isNotBlank()) {
            log("Using explicit modelPath: $explicitPath")
            return explicitPath
        }
        val modelKey = options.optString("model", "gemma-4-E2B")
        val entry = MODEL_REGISTRY[modelKey]
            ?: throw Exception("Unknown model '$modelKey'. Available: ${MODEL_REGISTRY.keys.joinToString()}")
        log("Model registry lookup: $modelKey")
        progress("lookup", 0, 0, 0, modelKey)
        return downloadModel(entry)
    }

    private fun ensureEngine(modelPath: String) {
        if (engine != null) {
            log("Engine already loaded — reusing warm instance")
            return
        }
        progress("engine_init", 0, 0, 0, "loading")
        engine = tryCreateEngine(modelPath)
        log("LiteRT-LM engine ready")
        progress("engine_init", 100, 0, 0, "ready")
    }

    private fun tryCreateEngine(modelPath: String): Engine {
        log("[tryCreateEngine] modelPath=$modelPath")
        log("[tryCreateEngine] Attempting Backend.GPU()...")
        return try {
            val config = EngineConfig(modelPath = modelPath, backend = Backend.GPU())
            log("[tryCreateEngine] EngineConfig created, constructing Engine...")
            val eng = Engine(config)
            log("[tryCreateEngine] Engine() constructed OK, calling initialize()...")
            eng.initialize()
            log("[tryCreateEngine] GPU engine initialized successfully")
            eng
        } catch (e: Exception) {
            log("[tryCreateEngine] GPU failed at: ${e.javaClass.simpleName}: ${e.message}")
            log("[tryCreateEngine] Falling back to Backend.CPU()...")
            try {
                val config = EngineConfig(modelPath = modelPath, backend = Backend.CPU())
                val eng = Engine(config)
                log("[tryCreateEngine] CPU Engine() constructed, calling initialize()...")
                eng.initialize()
                log("[tryCreateEngine] CPU engine initialized successfully")
                eng
            } catch (e2: Exception) {
                log("[tryCreateEngine] CPU also failed: ${e2.javaClass.simpleName}: ${e2.message}")
                throw e2
            }
        }
    }

    private fun downloadModel(entry: ModelEntry): String {
        val modelsDir = File(context.filesDir, "ai_models").also { it.mkdirs() }
        val modelFile = File(modelsDir, entry.filename)

        if (modelFile.exists() && modelFile.length() > 0) {
            log("Model cache hit: ${entry.filename} (${modelFile.length() / 1_000_000}MB)")
            progress("cache", 100, modelFile.length(), modelFile.length(), "cached")
            return modelFile.absolutePath
        }

        log("Downloading model: ${entry.filename} from HuggingFace (~${entry.sizeHint / 1_000_000}MB)")
        progress("download", 0, 0, entry.sizeHint, "starting")

        // The partial and its ETag stay on disk across failures and launches so the next attempt resumes.
        val tempFile = File(modelsDir, "${entry.filename}.tmp")
        val etagFile = File(modelsDir, "${entry.filename}.tmp.etag")
        var lastPct = -1
        var lastEmitMs = System.currentTimeMillis()
        val downloader = ResumableDownloader(
            userAgent = "CatalystCore/1.0 LiteRT-LM",
            log = { log(it) },
            onBytes = { loaded, announced ->
                val total = if (announced > 0) announced else entry.sizeHint
                val pct = if (total > 0) minOf(100, ((loaded * 100) / total).toInt()) else -1
                val now = System.currentTimeMillis()
                if (pct != lastPct || now - lastEmitMs >= 200) {
                    lastPct = pct
                    lastEmitMs = now
                    val mb = loaded / 1_000_000
                    val totalMb = total / 1_000_000
                    progress("download", maxOf(pct, 0), loaded, total, "${mb}MB / ${totalMb}MB")
                    log("Download: $pct% (${mb}MB / ${totalMb}MB)")
                }
            },
        )
        try {
            val size = downloader.download(entry.url, tempFile, etagFile)
            modelFile.delete()
            if (!tempFile.renameTo(modelFile)) throw Exception("could not move the model into place")
            etagFile.delete()
            log("Download complete: ${size / 1_000_000}MB saved to ${modelFile.absolutePath}")
            progress("download", 100, size, size, "complete")
        } catch (e: Exception) {
            if ((e as? DownloadException)?.discardPartial == true) downloader.discard(tempFile, etagFile)
            throw Exception("Model download failed: ${e.message}", e)
        }

        return modelFile.absolutePath
    }

    private fun log(msg: String) {
        Log.d(TAG, "[AI] $msg")
        onLog(msg)
    }

    private fun progress(phase: String, percent: Int, bytesLoaded: Long, bytesTotal: Long, detail: String) {
        onProgress(phase, percent, bytesLoaded, bytesTotal, detail)
    }
}

sealed class InitResult {
    object AlreadyRunning : InitResult()
    data class Ready(
        val streamSupplier: suspend (String, JSONObject, String?) -> Pair<String, kotlinx.coroutines.flow.Flow<String>>,
        val systemPrompt: String,
    ) : InitResult()
    data class Error(val cause: Exception) : InitResult()
}
