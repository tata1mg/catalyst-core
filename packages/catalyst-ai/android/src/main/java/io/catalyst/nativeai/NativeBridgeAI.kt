package io.catalyst.nativeai

import android.content.Context
import android.util.Log
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onCompletion
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import android.util.Base64
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

    // What the loaded engine was actually initialised with. Image/audio parts are refused (not dropped) when false.
    private var visionEnabled = false
    private var audioEnabled = false
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
        val mediaFiles = mutableListOf<File>()
        val contents = try {
            buildContents(prompt, genConfig, mediaFiles)
        } catch (e: Exception) {
            mediaFiles.forEach { it.delete() }
            throw e
        }
        val tokenFlow = conversation.sendMessageAsync(contents).map { message ->
            message.contents.contents
                .filterIsInstance<Content.Text>()
                .joinToString("") { it.text }
        }.onCompletion { mediaFiles.forEach { it.delete() } }
        return Pair(activeConvId, tokenFlow)
    }

    /**
     * Text-only requests stay a plain prompt. With genConfig.inputParts ([{type, mimeType, base64}], produced by
     * catalyst-ai's buildNativeBody) the media is written to temp files and sent as Content.ImageFile/AudioFile
     * ahead of the text. Temp files are removed when the response flow completes or is cancelled.
     */
    private fun buildContents(prompt: String, genConfig: JSONObject, mediaFiles: MutableList<File>): Contents {
        val parts = genConfig.optJSONArray("inputParts")
        if (parts == null || parts.length() == 0) return Contents.of(prompt)

        val dir = File(context.cacheDir, "ai_input").also { it.mkdirs() }
        val items = mutableListOf<Content>()
        for (i in 0 until parts.length()) {
            val part = parts.getJSONObject(i)
            val type = part.optString("type")
            val enabled = when (type) {
                "image" -> visionEnabled
                "audio" -> audioEnabled
                else -> throw IllegalArgumentException("Unsupported input part type: $type")
            }
            if (!enabled) throw IllegalStateException("The loaded model does not support $type input")
            val ext = part.optString("mimeType").substringAfter('/', "bin").substringBefore('+').ifBlank { "bin" }
            val file = File(dir, "${UUID.randomUUID()}.$ext")
            file.writeBytes(Base64.decode(part.getString("base64"), Base64.DEFAULT))
            mediaFiles.add(file)
            items.add(if (type == "image") Content.ImageFile(file.absolutePath) else Content.AudioFile(file.absolutePath))
        }
        items.add(Content.Text(prompt))
        log("Multimodal turn: ${parts.length()} media part(s) + text")
        return Contents.of(items)
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

    /**
     * Tries multimodal first (vision on GPU, audio on CPU, as LiteRT-LM recommends), then falls back to text-only
     * so text-only models (e.g. Qwen3) and devices without a vision/audio executor still load. Same GPU -> CPU
     * order as before within each tier. The flags record what the surviving engine really supports.
     */
    private fun tryCreateEngine(modelPath: String): Engine {
        log("[tryCreateEngine] modelPath=$modelPath")
        val cacheDir = File(context.cacheDir, "litertlm").also { it.mkdirs() }.absolutePath
        data class Attempt(val label: String, val main: Backend, val vision: Backend?, val audio: Backend?)
        val attempts = listOf(
            Attempt("GPU+vision+audio", Backend.GPU(), Backend.GPU(), Backend.CPU()),
            Attempt("CPU+vision+audio", Backend.CPU(), Backend.CPU(), Backend.CPU()),
            Attempt("GPU text-only", Backend.GPU(), null, null),
            Attempt("CPU text-only", Backend.CPU(), null, null),
        )
        var last: Exception? = null
        for (a in attempts) {
            log("[tryCreateEngine] Attempting ${a.label}...")
            try {
                val config = EngineConfig(
                    modelPath = modelPath,
                    backend = a.main,
                    visionBackend = a.vision,
                    audioBackend = a.audio,
                    cacheDir = cacheDir,
                )
                val eng = Engine(config)
                eng.initialize()
                visionEnabled = a.vision != null
                audioEnabled = a.audio != null
                log("[tryCreateEngine] ${a.label} initialized (vision=$visionEnabled audio=$audioEnabled)")
                return eng
            } catch (e: Exception) {
                log("[tryCreateEngine] ${a.label} failed: ${e.javaClass.simpleName}: ${e.message}")
                last = e
            }
        }
        throw last ?: IllegalStateException("No engine configuration succeeded")
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

        val tempFile = File(modelsDir, "${entry.filename}.tmp")
        try {
            val conn = (URL(entry.url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 30_000
                readTimeout = 60_000
                setRequestProperty("User-Agent", "CatalystCore/1.0 LiteRT-LM")
                instanceFollowRedirects = true
                connect()
            }

            val responseCode = conn.responseCode
            if (responseCode !in 200..299) throw Exception("HTTP $responseCode from model server")

            val contentLength = conn.contentLengthLong.takeIf { it > 0 } ?: entry.sizeHint
            log("Content-Length: ${contentLength / 1_000_000}MB — downloading...")

            conn.inputStream.use { input ->
                tempFile.outputStream().use { output ->
                    val buf = ByteArray(128 * 1024)
                    var loaded = 0L
                    var lastPct = -1
                    var lastEmitMs = System.currentTimeMillis()

                    while (true) {
                        val n = input.read(buf)
                        if (n == -1) break
                        output.write(buf, 0, n)
                        loaded += n

                        val pct = if (contentLength > 0) ((loaded * 100) / contentLength).toInt() else -1
                        val now = System.currentTimeMillis()
                        if (pct != lastPct || now - lastEmitMs >= 200) {
                            lastPct = pct
                            lastEmitMs = now
                            val mb = loaded / 1_000_000
                            val totalMb = contentLength / 1_000_000
                            progress("download", maxOf(pct, 0), loaded, contentLength, "${mb}MB / ${totalMb}MB")
                            log("Download: $pct% (${mb}MB / ${totalMb}MB)")
                        }
                    }
                }
            }

            conn.disconnect()
            if (tempFile.length() == 0L) throw Exception("Downloaded file is empty")
            tempFile.renameTo(modelFile)
            log("Download complete: ${modelFile.length() / 1_000_000}MB saved to ${modelFile.absolutePath}")
            progress("download", 100, modelFile.length(), modelFile.length(), "complete")

        } catch (e: Exception) {
            tempFile.delete()
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
