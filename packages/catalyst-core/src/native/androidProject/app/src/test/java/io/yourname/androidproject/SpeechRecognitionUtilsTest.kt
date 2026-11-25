package io.yourname.androidproject

import android.speech.SpeechRecognizer
import io.yourname.androidproject.utils.SpeechRecognitionUtils
import io.yourname.androidproject.utils.SpeechRecognitionUtils.Code
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** The pure side of the speech recognition bridge: options, error codes and event payloads. */
class SpeechRecognitionUtilsTest {

    // ---- parseLanguage

    @Test
    fun `parseLanguage reads the language the page asked for`() {
        assertEquals("en-IN", SpeechRecognitionUtils.parseLanguage("""{"language":"en-IN"}"""))
    }

    @Test
    fun `parseLanguage defaults to en-US when there is none, it is blank, or the config is not JSON`() {
        assertEquals("en-US", SpeechRecognitionUtils.parseLanguage(null))
        assertEquals("en-US", SpeechRecognitionUtils.parseLanguage(""))
        assertEquals("en-US", SpeechRecognitionUtils.parseLanguage("{}"))
        assertEquals("en-US", SpeechRecognitionUtils.parseLanguage("""{"language":"  "}"""))
        assertEquals("en-US", SpeechRecognitionUtils.parseLanguage("not json"))
    }

    // ---- errorCode

    @Test
    fun `silence and no match are NO_SPEECH`() {
        assertEquals(Code.NO_SPEECH, SpeechRecognitionUtils.errorCode(SpeechRecognizer.ERROR_NO_MATCH))
        assertEquals(Code.NO_SPEECH, SpeechRecognitionUtils.errorCode(SpeechRecognizer.ERROR_SPEECH_TIMEOUT))
    }

    @Test
    fun `permission, audio, busy and client errors keep their meaning`() {
        assertEquals(Code.PERMISSION_DENIED, SpeechRecognitionUtils.errorCode(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS))
        assertEquals(Code.AUDIO, SpeechRecognitionUtils.errorCode(SpeechRecognizer.ERROR_AUDIO))
        assertEquals(Code.BUSY, SpeechRecognitionUtils.errorCode(SpeechRecognizer.ERROR_RECOGNIZER_BUSY))
        assertEquals(Code.CANCELLED, SpeechRecognitionUtils.errorCode(SpeechRecognizer.ERROR_CLIENT))
    }

    @Test
    fun `a network or server error means the recognizer tried to leave the device, so it is ON_DEVICE_UNAVAILABLE`() {
        assertEquals(Code.ON_DEVICE_UNAVAILABLE, SpeechRecognitionUtils.errorCode(SpeechRecognizer.ERROR_NETWORK))
        assertEquals(Code.ON_DEVICE_UNAVAILABLE, SpeechRecognitionUtils.errorCode(SpeechRecognizer.ERROR_NETWORK_TIMEOUT))
        assertEquals(Code.ON_DEVICE_UNAVAILABLE, SpeechRecognitionUtils.errorCode(SpeechRecognizer.ERROR_SERVER))
        assertEquals(Code.ON_DEVICE_UNAVAILABLE, SpeechRecognitionUtils.errorCode(11)) // ERROR_SERVER_DISCONNECTED
    }

    @Test
    fun `language errors from newer Android versions are LANGUAGE_UNAVAILABLE`() {
        assertEquals(Code.LANGUAGE_UNAVAILABLE, SpeechRecognitionUtils.errorCode(12)) // ERROR_LANGUAGE_NOT_SUPPORTED
        assertEquals(Code.LANGUAGE_UNAVAILABLE, SpeechRecognitionUtils.errorCode(13)) // ERROR_LANGUAGE_UNAVAILABLE
    }

    @Test
    fun `anything else is UNKNOWN`() {
        assertEquals(Code.UNKNOWN, SpeechRecognitionUtils.errorCode(10)) // ERROR_TOO_MANY_REQUESTS
        assertEquals(Code.UNKNOWN, SpeechRecognitionUtils.errorCode(999))
    }

    @Test
    fun `the shared codes are the strings the iOS shell sends`() {
        assertEquals(
            listOf("ON_DEVICE_UNAVAILABLE", "LANGUAGE_UNAVAILABLE", "PERMISSION_DENIED", "NO_SPEECH", "AUDIO", "BUSY", "CANCELLED", "UNKNOWN"),
            listOf(Code.ON_DEVICE_UNAVAILABLE, Code.LANGUAGE_UNAVAILABLE, Code.PERMISSION_DENIED, Code.NO_SPEECH,
                Code.AUDIO, Code.BUSY, Code.CANCELLED, Code.UNKNOWN)
        )
    }

    // ---- payloads

    @Test
    fun `text and state payloads are JSON objects`() {
        assertEquals("hello \"world\"", JSONObject(SpeechRecognitionUtils.textPayload("hello \"world\"")).getString("text"))
        assertEquals("listening", JSONObject(SpeechRecognitionUtils.statePayload("listening")).getString("state"))
    }

    @Test
    fun `error payload carries the code and message`() {
        val json = JSONObject(SpeechRecognitionUtils.errorPayload(Code.NO_SPEECH, "nothing heard"))
        assertEquals("NO_SPEECH", json.getString("code"))
        assertEquals("nothing heard", json.getString("message"))
    }

    @Test
    fun `support payload says on-device only when available, and carries installed and reason when given`() {
        val ok = JSONObject(SpeechRecognitionUtils.supportPayload(true, "en-US", installed = true))
        assertTrue(ok.getBoolean("available"))
        assertTrue(ok.getBoolean("onDevice"))
        assertTrue(ok.getBoolean("installed"))
        assertEquals("en-US", ok.getString("language"))
        assertFalse(ok.has("reason"))

        val no = JSONObject(SpeechRecognitionUtils.supportPayload(false, "en-US", reason = Code.ON_DEVICE_UNAVAILABLE))
        assertFalse(no.getBoolean("available"))
        assertFalse(no.getBoolean("onDevice"))
        assertEquals("ON_DEVICE_UNAVAILABLE", no.getString("reason"))
        assertFalse(no.has("installed"))
    }

    @Test
    fun `only an installed language is available on the device, a language that is merely supported still has to be downloaded`() {
        assertEquals(true to null, SpeechRecognitionUtils.availabilityOf(installed = true))
        assertEquals(false to Code.LANGUAGE_UNAVAILABLE, SpeechRecognitionUtils.availabilityOf(installed = false))
    }
}
