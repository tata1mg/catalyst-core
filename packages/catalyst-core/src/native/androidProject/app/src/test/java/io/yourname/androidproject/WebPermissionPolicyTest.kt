package io.yourname.androidproject

import android.webkit.PermissionRequest
import io.yourname.androidproject.utils.WebPermissionPolicy
import org.junit.Assert.assertArrayEquals
import org.junit.Test

/** Which web permission requests the WebView may grant: only camera and microphone, and only when the app holds them. */
class WebPermissionPolicyTest {

    private val video = PermissionRequest.RESOURCE_VIDEO_CAPTURE
    private val audio = PermissionRequest.RESOURCE_AUDIO_CAPTURE
    private val protectedMedia = PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID

    private fun grant(requested: Array<String>?, camera: Boolean, microphone: Boolean) =
        WebPermissionPolicy.grantable(requested, camera, microphone)

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
}
