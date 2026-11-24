package io.yourname.androidproject

import android.webkit.PermissionRequest
import io.yourname.androidproject.utils.WebPermissionPolicy
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which web permission requests the WebView may grant: only camera and microphone, and only when the app holds them. */
class WebPermissionPolicyTest {

    private val video = PermissionRequest.RESOURCE_VIDEO_CAPTURE
    private val audio = PermissionRequest.RESOURCE_AUDIO_CAPTURE
    private val protectedMedia = PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID

    private fun grant(requested: Array<String>?, camera: Boolean, microphone: Boolean, trusted: Boolean = true) =
        WebPermissionPolicy.grantable(requested, camera, microphone, originTrusted = trusted)

    @Test
    fun `grants the microphone when the app holds RECORD_AUDIO`() {
        assertArrayEquals(arrayOf(audio), grant(arrayOf(audio), camera = false, microphone = true))
    }

    @Test
    fun `denies the microphone when the app does not hold RECORD_AUDIO`() {
        assertArrayEquals(emptyArray<String>(), grant(arrayOf(audio), camera = true, microphone = false))
    }

    @Test
    fun `grants the camera when the app holds CAMERA, as before`() {
        assertArrayEquals(arrayOf(video), grant(arrayOf(video), camera = true, microphone = false))
        assertArrayEquals(emptyArray<String>(), grant(arrayOf(video), camera = false, microphone = true))
    }

    @Test
    fun `grants only the half of a camera and microphone request that the app holds`() {
        assertArrayEquals(arrayOf(video), grant(arrayOf(video, audio), camera = true, microphone = false))
        assertArrayEquals(arrayOf(audio), grant(arrayOf(video, audio), camera = false, microphone = true))
        assertArrayEquals(arrayOf(video, audio), grant(arrayOf(video, audio), camera = true, microphone = true))
    }

    @Test
    fun `never grants anything else, even with every permission held`() {
        assertArrayEquals(emptyArray<String>(), grant(arrayOf(protectedMedia), camera = true, microphone = true))
        assertArrayEquals(arrayOf(audio), grant(arrayOf(protectedMedia, audio), camera = true, microphone = true))
    }

    @Test
    fun `an empty or missing request grants nothing`() {
        assertArrayEquals(emptyArray<String>(), grant(emptyArray(), camera = true, microphone = true))
        assertArrayEquals(emptyArray<String>(), grant(null, camera = true, microphone = true))
    }

    @Test
    fun `an untrusted origin gets nothing even when the app holds every permission`() {
        assertArrayEquals(emptyArray<String>(), grant(arrayOf(video, audio), camera = true, microphone = true, trusted = false))
    }

    private val app = "https://app.example.com/home"
    private fun trusted(origin: String?) = WebPermissionPolicy.isTrustedOrigin(origin, app)

    @Test
    fun `the app's own origin is trusted, whatever the path, case or default port`() {
        assertTrue(trusted("https://app.example.com"))
        assertTrue(trusted("https://APP.example.com:443/other/page?x=1"))
    }

    @Test
    fun `another host, scheme or port is not trusted`() {
        assertFalse(trusted("https://evil.example.org"))
        assertFalse(trusted("http://app.example.com"))
        assertFalse(trusted("https://app.example.com:8443"))
    }

    @Test
    fun `a lookalike host is not trusted, so a substring match can never let it in`() {
        assertFalse(trusted("https://app.example.com.evil.org"))
        assertFalse(trusted("https://evilapp.example.com"))
        assertFalse(trusted("https://sub.app.example.com"))
    }

    @Test
    fun `a missing or non-web origin is not trusted`() {
        assertFalse(trusted(null))
        assertFalse(trusted(""))
        assertFalse(trusted("file:///android_asset/index.html"))
        assertFalse(trusted("not a url"))
    }

    @Test
    fun `nothing is trusted before the app url is known`() {
        assertFalse(WebPermissionPolicy.isTrustedOrigin("https://app.example.com", null))
    }
}
