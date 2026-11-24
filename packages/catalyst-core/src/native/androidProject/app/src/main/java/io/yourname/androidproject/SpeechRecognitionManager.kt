package io.yourname.androidproject

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.WebView
import androidx.core.content.ContextCompat
import io.yourname.androidproject.utils.BridgeUtils
import io.yourname.androidproject.utils.MicrophoneUtils
import io.yourname.androidproject.utils.SpeechRecognitionUtils as Speech

/**
 * Speech to text by the platform's own recognizer, on the device only. The audio never goes to a server: the on-device
 * recognizer is the only one this class creates, and when it is not available the page gets ON_DEVICE_UNAVAILABLE.
 * Partial text streams while the person talks and a final text arrives when they stop (the recognizer ends by itself
 * after a pause). SpeechRecognizer must be created and used on the main thread; the bridge calls in from there.
 */
class SpeechRecognitionManager(private val activity: Activity, private val webView: WebView) {

    private var recognizer: SpeechRecognizer? = null

    private fun notify(event: BridgeUtils.WebEvents, payload: String) = BridgeUtils.notifyWeb(webView, event, payload)

    private fun onDeviceAvailable(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)

    private fun intentFor(language: String) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
    }

    /** Answers SPEECH_RECOGNITION_SUPPORT: is on-device recognition possible here, and is this language installed. */
    fun getSupport(language: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_SUPPORT,
                Speech.supportPayload(false, language, reason = "ANDROID_VERSION"))
            return
        }
        if (!onDeviceAvailable()) {
            notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_SUPPORT,
                Speech.supportPayload(false, language, reason = Speech.Code.ON_DEVICE_UNAVAILABLE))
            return
        }
        // Which languages are installed on the device is only known by asking the recognizer itself.
        val probe = SpeechRecognizer.createOnDeviceSpeechRecognizer(activity)
        probe.checkRecognitionSupport(intentFor(language), ContextCompat.getMainExecutor(activity),
            object : RecognitionSupportCallback {
                override fun onSupportResult(support: RecognitionSupport) {
                    val installed = support.installedOnDeviceLanguages.any { it.equals(language, ignoreCase = true) }
                    val supported = installed || support.supportedOnDeviceLanguages.any { it.equals(language, ignoreCase = true) }
                    probe.destroy()
                    notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_SUPPORT,
                        Speech.supportPayload(supported, language, installed,
                            if (supported) null else Speech.Code.LANGUAGE_UNAVAILABLE))
                }

                override fun onError(error: Int) {
                    probe.destroy()
                    notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_SUPPORT,
                        Speech.supportPayload(false, language, reason = Speech.errorCode(error)))
                }
            })
    }

    fun start(language: String) {
        if (!MicrophoneUtils.hasMicrophonePermission(activity)) {
            notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_ERROR,
                Speech.errorPayload(Speech.Code.PERMISSION_DENIED, "Microphone permission is needed"))
            return
        }
        // The SDK check sits here, next to createOnDeviceSpeechRecognizer (API 31), so Android Lint can see it;
        // onDeviceAvailable() repeats it, which is harmless.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !onDeviceAvailable()) {
            notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_ERROR,
                Speech.errorPayload(Speech.Code.ON_DEVICE_UNAVAILABLE, "On-device speech recognition is not available on this device"))
            return
        }
        if (recognizer != null) {
            notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_ERROR,
                Speech.errorPayload(Speech.Code.BUSY, "Speech recognition is already running"))
            return
        }
        val created = SpeechRecognizer.createOnDeviceSpeechRecognizer(activity)
        recognizer = created
        created.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) =
                notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_STATE, Speech.statePayload("listening"))

            override fun onPartialResults(partialResults: Bundle?) {
                bestText(partialResults)?.let { notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_PARTIAL, Speech.textPayload(it)) }
            }

            override fun onResults(results: Bundle?) {
                val text = bestText(results) ?: ""
                release()
                notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_FINAL, Speech.textPayload(text))
                notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_STATE, Speech.statePayload("idle"))
            }

            override fun onError(error: Int) {
                release()
                notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_ERROR,
                    Speech.errorPayload(Speech.errorCode(error), "SpeechRecognizer error $error"))
                notify(BridgeUtils.WebEvents.SPEECH_RECOGNITION_STATE, Speech.statePayload("idle"))
            }

            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        created.startListening(intentFor(language))
    }

    /** Ends the session; the recognizer then delivers the final text for what it has heard. */
    fun stop() {
        recognizer?.stopListening()
    }

    fun cleanup() = release()

    private fun release() {
        recognizer?.destroy()
        recognizer = null
    }

    private fun bestText(bundle: Bundle?): String? =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }
}
