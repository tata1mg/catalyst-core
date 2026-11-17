package io.catalyst.nativeai

import org.json.JSONObject

/** Builds app and optional attachment instructions without loading the native model. */
internal fun buildAISystemPrompt(options: JSONObject, log: (String) -> Unit = {}): String {
    val attachmentComponents = options.optJSONObject("attachmentComponents")
    if (attachmentComponents == null || attachmentComponents.length() == 0) {
        // No components to describe, but the app's own systemPrompt must still reach the model.
        val systemPrompt = options.optString("systemPrompt", "").trim()
        log("[attachments] No attachmentComponents provided — using the app systemPrompt only (${systemPrompt.length} chars)")
        return systemPrompt
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
    val systemPrompt = sb.toString().trim()
    log("[attachments] System prompt set (${systemPrompt.length} chars)")
    return systemPrompt
}
