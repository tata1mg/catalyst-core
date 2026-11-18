package io.yourname.androidproject.utils

import android.speech.SpeechRecognizer
import org.json.JSONObject

/**
 * Pure helpers for the speech recognition bridge: parsing the page's options, mapping the platform's error codes to the
 * codes both shells share with the page, and building the event payloads. The iOS shell sends the same codes and the
 * same payload shapes (SpeechRecognitionPolicy in CoreLogic).
 */
object SpeechRecognitionUtils {

    const val DEFAULT_LANGUAGE = "en-US"

    /** Codes the page sees in SPEECH_RECOGNITION_ERROR, identical on Android and iOS. */
    object Code {
        const val ON_DEVICE_UNAVAILABLE = "ON_DEVICE_UNAVAILABLE"
        const val LANGUAGE_UNAVAILABLE = "LANGUAGE_UNAVAILABLE"
        const val PERMISSION_DENIED = "PERMISSION_DENIED"
        const val NO_SPEECH = "NO_SPEECH"
        const val AUDIO = "AUDIO"
        const val BUSY = "BUSY"
        const val CANCELLED = "CANCELLED"
        const val UNKNOWN = "UNKNOWN"
    }

    /** The language the page asked for ({"language":"en-US"}), or the default when it asked for none. */
    fun parseLanguage(config: String?): String {
        if (config.isNullOrBlank()) return DEFAULT_LANGUAGE
        return try {
            JSONObject(config).optString("language", "").ifBlank { DEFAULT_LANGUAGE }
        } catch (e: org.json.JSONException) {
            DEFAULT_LANGUAGE
        }
    }

    /**
     * SpeechRecognizer.ERROR_* to a shared code. A network or server error from the on-device recognizer means it tried to
     * leave the device, which this bridge never allows, so those are reported as ON_DEVICE_UNAVAILABLE.
     */
    fun errorCode(recognizerError: Int): String = when (recognizerError) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> Code.NO_SPEECH
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> Code.PERMISSION_DENIED
        SpeechRecognizer.ERROR_AUDIO -> Code.AUDIO
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> Code.BUSY
        SpeechRecognizer.ERROR_CLIENT -> Code.CANCELLED
        12, 13 -> Code.LANGUAGE_UNAVAILABLE // ERROR_LANGUAGE_NOT_SUPPORTED / ERROR_LANGUAGE_UNAVAILABLE (API 33)
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER,
        11 -> Code.ON_DEVICE_UNAVAILABLE // 11 = ERROR_SERVER_DISCONNECTED (API 31)
        else -> Code.UNKNOWN
    }

    fun textPayload(text: String): String = JSONObject().put("text", text).toString()

    fun statePayload(state: String): String = JSONObject().put("state", state).toString()

    fun errorPayload(code: String, message: String): String =
        JSONObject().put("code", code).put("message", message).toString()

    /** { available, onDevice, language, installed?, reason? }; `installed` is whether that language's model is on the device. */
    fun supportPayload(available: Boolean, language: String, installed: Boolean? = null, reason: String? = null): String {
        val json = JSONObject().put("available", available).put("onDevice", available).put("language", language)
        if (installed != null) json.put("installed", installed)
        if (reason != null) json.put("reason", reason)
        return json.toString()
    }
}
