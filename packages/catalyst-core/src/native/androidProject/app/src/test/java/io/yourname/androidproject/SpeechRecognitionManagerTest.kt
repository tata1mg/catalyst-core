package io.yourname.androidproject

import android.app.Activity
import android.content.pm.PackageManager
import android.webkit.WebView
import androidx.core.content.ContextCompat
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.MockedStatic
import org.mockito.Mockito.mockStatic
import org.mockito.kotlin.any
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.isNull
import org.mockito.kotlin.mock
import org.mockito.kotlin.never
import org.mockito.kotlin.verify

/**
 * SpeechRecognitionManager paths that run without a real recognizer. Under the mockable android.jar
 * Build.VERSION.SDK_INT is 0, so everything that needs Android 13 reports the version/availability refusal; that is
 * exactly what the page must be told on an older phone. The recognizer-driven paths are covered on a device.
 */
class SpeechRecognitionManagerTest {

    private lateinit var activity: Activity
    private lateinit var webView: WebView
    private lateinit var contextCompat: MockedStatic<ContextCompat>
    private lateinit var manager: SpeechRecognitionManager

    @Before
    fun setUp() {
        activity = mock()
        webView = mock()
        contextCompat = mockStatic(ContextCompat::class.java)
        manager = SpeechRecognitionManager(activity, webView)
    }

    @After
    fun tearDown() {
        contextCompat.close()
    }

    private fun microphone(granted: Boolean) {
        contextCompat.`when`<Int> { ContextCompat.checkSelfPermission(any(), any()) }
            .thenReturn(if (granted) PackageManager.PERMISSION_GRANTED else PackageManager.PERMISSION_DENIED)
    }

    /** Everything the page was told, in order. */
    private fun sent(): List<String> {
        val js = argumentCaptor<String>()
        verify(webView, org.mockito.kotlin.atLeast(0)).evaluateJavascript(js.capture(), isNull())
        return js.allValues
    }

    @Test
    fun `getSupport tells the page the Android version is too old, and names the language it was asked about`() {
        manager.getSupport("en-US")
        val told = sent().joinToString()
        assertTrue(told, told.contains("SPEECH_RECOGNITION_SUPPORT"))
        assertTrue(told, told.contains("ANDROID_VERSION"))
        assertTrue(told, told.contains("en-US"))
    }

    @Test
    fun `start without the microphone permission reports PERMISSION_DENIED and starts nothing`() {
        microphone(granted = false)
        manager.start("en-US")
        val told = sent().joinToString()
        assertTrue(told, told.contains("SPEECH_RECOGNITION_ERROR"))
        assertTrue(told, told.contains("PERMISSION_DENIED"))
    }

    @Test
    fun `start with the microphone but no on-device recognizer reports ON_DEVICE_UNAVAILABLE`() {
        microphone(granted = true)
        manager.start("en-IN")
        val told = sent().joinToString()
        assertTrue(told, told.contains("SPEECH_RECOGNITION_ERROR"))
        assertTrue(told, told.contains("ON_DEVICE_UNAVAILABLE"))
        assertFalse(told, told.contains("PERMISSION_DENIED"))
    }

    @Test
    fun `stop and cleanup with no session running are safe and tell the page nothing`() {
        manager.stop()
        manager.cleanup()
        manager.cleanup()
        verify(webView, never()).evaluateJavascript(any(), any())
    }
}
