package io.yourname.androidproject

import android.app.Activity
import android.content.pm.PackageManager
import android.webkit.WebView
import androidx.core.content.ContextCompat
import io.yourname.androidproject.utils.MicrophoneUtils
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.MockedStatic
import org.mockito.Mockito.mockStatic
import org.mockito.kotlin.any
import org.mockito.kotlin.eq
import org.mockito.kotlin.isNull
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify

/**
 * Unit tests for MicrophoneUtils: the RECORD_AUDIO check and the status the page is told after a request.
 * Same approach as CameraUtilsTest: ContextCompat.checkSelfPermission is a static SDK call, mocked statically;
 * the result reaches the page through BridgeUtils.notifyWeb against a mocked WebView.
 */
class MicrophoneUtilsTest {

    private lateinit var activity: Activity
    private lateinit var contextCompatMock: MockedStatic<ContextCompat>

    @Before
    fun setUp() {
        activity = mock()
        contextCompatMock = mockStatic(ContextCompat::class.java)
    }

    @After
    fun tearDown() {
        contextCompatMock.close()
    }

    private fun stubPermission(granted: Boolean) {
        contextCompatMock.`when`<Int> { ContextCompat.checkSelfPermission(any(), any()) }
            .thenReturn(if (granted) PackageManager.PERMISSION_GRANTED else PackageManager.PERMISSION_DENIED)
    }

    @Test
    fun `asks for RECORD_AUDIO`() {
        assertEquals("android.permission.RECORD_AUDIO", MicrophoneUtils.MICROPHONE_PERMISSION)
    }

    @Test
    fun `hasMicrophonePermission follows what ContextCompat reports`() {
        stubPermission(granted = true)
        assertTrue(MicrophoneUtils.hasMicrophonePermission(activity))
        stubPermission(granted = false)
        assertFalse(MicrophoneUtils.hasMicrophonePermission(activity))
    }

    @Test
    fun `getPermissionStatus is GRANTED or DENIED`() {
        stubPermission(granted = true)
        assertEquals("GRANTED", MicrophoneUtils.getPermissionStatus(activity))
        stubPermission(granted = false)
        assertEquals("DENIED", MicrophoneUtils.getPermissionStatus(activity))
    }

    @Test
    fun `handlePermissionResult tells the page GRANTED on the microphone event`() {
        val webView: WebView = mock()
        MicrophoneUtils.handlePermissionResult(webView, true)
        verify(webView).evaluateJavascript(
            eq("window.WebBridge.callback('MICROPHONE_PERMISSION_STATUS', ${JSONObject.quote("GRANTED")})"),
            isNull()
        )
    }

    @Test
    fun `handlePermissionResult tells the page DENIED when the user refuses`() {
        val webView: WebView = mock()
        MicrophoneUtils.handlePermissionResult(webView, false)
        verify(webView).evaluateJavascript(
            eq("window.WebBridge.callback('MICROPHONE_PERMISSION_STATUS', ${JSONObject.quote("DENIED")})"),
            isNull()
        )
    }
}
