package io.yourname.androidproject

import io.yourname.androidproject.utils.PerfDeliveryState
import io.yourname.androidproject.utils.ProfilerNavigationState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfilerLifecycleTest {
    @Test
    fun `offline startup and retry navigation record separate page lifecycles`() {
        val state = ProfilerNavigationState()
        val offlineStart = state.begin("file:///android_asset/offline/offline.html")
        val retry = state.begin("https://example.com")

        assertFalse(offlineStart.shouldReset)
        assertEquals("file:///android_asset/offline/offline.html", offlineStart.url)
        assertTrue(retry.shouldReset)
        assertEquals("https://example.com", retry.url)
    }

    @Test
    fun `batch remains in flight until acknowledged and retries retain its id`() {
        val state = PerfDeliveryState<List<String>>()
        val batch = state.begin(listOf("boot-activity-created"))

        assertNotNull(batch)
        assertNull(state.begin(listOf("boot-page-started")))

        val retry = state.retry(batch!!, maxRetries = 2)
        assertNotNull(retry)
        assertEquals(batch.id, retry!!.id)
        assertEquals(1, retry.retryCount)
        assertTrue(state.acknowledge(retry))
        assertNotNull(state.begin(listOf("boot-page-started")))
    }

    @Test
    fun `reset invalidates stale delivery callbacks`() {
        val state = PerfDeliveryState<List<String>>()
        val batch = state.begin(listOf("boot-load-url"))!!

        state.reset()

        assertFalse(state.acknowledge(batch))
        assertNull(state.retry(batch, maxRetries = 2))
    }
}
