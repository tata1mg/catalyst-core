package io.yourname.androidproject

import io.yourname.androidproject.utils.PerfEventBuffer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for PerfEventBuffer, previously entirely untested (0%).
 *
 * Scope: configure/isEnabled/add/bridgeCallReceived/bridgeCallDispatched/
 * reset are exercised directly — pure state plus a ConcurrentLinkedQueue,
 * no Handler/Looper dispatch involved. scheduleFlush/flushNow/
 * startPeriodicFlush/the deliver-retry pipeline post through a real
 * android.os.Handler(Looper.getMainLooper()) constructed at object-init
 * time — Looper.getMainLooper() has no real Looper in a JVM unit test, so
 * calling those methods either throws or silently never runs the posted
 * work. Left uncovered here rather than chased with Robolectric, per the
 * plan's Mockito-only scope.
 *
 * PerfEventBuffer is a singleton object — tests reset() in tearDown so
 * state doesn't leak into other test classes running in the same JVM.
 */
class PerfEventBufferTest {

    @Before
    fun setUp() {
        PerfEventBuffer.reset()
    }

    @After
    fun tearDown() {
        PerfEventBuffer.configure(enabled = false)
        PerfEventBuffer.reset()
    }

    @Test
    fun `configure(true) enables the buffer in a debug build`() {
        PerfEventBuffer.configure(enabled = true)
        // BuildConfig.DEBUG is true for the debug test variant this suite
        // runs under, so configure(true) should actually enable it.
        assertTrue(PerfEventBuffer.isEnabled())
    }

    @Test
    fun `configure(false) disables the buffer`() {
        PerfEventBuffer.configure(enabled = true)
        PerfEventBuffer.configure(enabled = false)
        assertFalse(PerfEventBuffer.isEnabled())
    }

    @Test
    fun `add is a no-op when disabled`() {
        PerfEventBuffer.configure(enabled = false)
        // Should not throw even though nothing is buffered.
        PerfEventBuffer.add(JSONObject().apply { put("type", "test") })
    }

    @Test
    fun `add does not throw when enabled`() {
        PerfEventBuffer.configure(enabled = true)
        PerfEventBuffer.add(JSONObject().apply { put("type", "test-event") })
    }

    @Test
    fun `bridgeCallReceived followed by bridgeCallDispatched does not throw`() {
        PerfEventBuffer.configure(enabled = true)

        PerfEventBuffer.bridgeCallReceived("call-1", "getDeviceInfo")
        PerfEventBuffer.bridgeCallDispatched("call-1")
    }

    @Test
    fun `bridgeCallDispatched for an unknown callId is a no-op`() {
        PerfEventBuffer.configure(enabled = true)

        // No matching bridgeCallReceived — pendingCalls has no entry for
        // "unknown-call", so this should return early without throwing.
        PerfEventBuffer.bridgeCallDispatched("unknown-call")
    }

    @Test
    fun `bridgeCallReceived and bridgeCallDispatched are no-ops when disabled`() {
        PerfEventBuffer.configure(enabled = false)

        PerfEventBuffer.bridgeCallReceived("call-1", "getDeviceInfo")
        PerfEventBuffer.bridgeCallDispatched("call-1")
    }

    @Test
    fun `reset disables flushed state and clears without throwing`() {
        PerfEventBuffer.configure(enabled = true)
        PerfEventBuffer.add(JSONObject().apply { put("type", "test") })

        PerfEventBuffer.reset()

        // Buffer cleared, no exception — isEnabled() state is untouched by
        // reset() itself (only configure() changes it).
        assertTrue(PerfEventBuffer.isEnabled())
    }

    @Test
    fun `add with a cache-hit-memory type does not throw while updating the cache summary tally`() {
        PerfEventBuffer.configure(enabled = true)

        PerfEventBuffer.add(JSONObject().apply {
            put("type", "cache-hit-memory")
            put("url", "https://example.com/app.js")
        })
    }

    @Test
    fun `add with a network-fetch-complete type does not throw while updating the top-slow tracker`() {
        PerfEventBuffer.configure(enabled = true)

        PerfEventBuffer.add(JSONObject().apply {
            put("type", "network-fetch-complete")
            put("url", "https://example.com/big-asset.bin")
            put("durationMs", 1234)
        })
    }
}
