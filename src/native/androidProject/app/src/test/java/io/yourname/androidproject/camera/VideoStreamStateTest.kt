package io.yourname.androidproject.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exhaustive truth-table tests for VideoStreamState, ported directly from
 * iOS's VideoStreamStateTests.swift (CoreLogic/Tests/CatalystCoreLogicTests)
 * — this Kotlin enum is a byte-for-byte match of the Swift one (same
 * states, same canTransitionTo table, same isActive derivation), so the
 * same 6x6 truth table applies unchanged.
 */
class VideoStreamStateTest {

    private val allStates = VideoStreamState.values().toList()

    // Every valid transition documented in VideoStreamState.kt's own
    // header comment, expressed as (from, to) pairs.
    private val validTransitions = setOf(
        VideoStreamState.IDLE to VideoStreamState.STARTING,
        VideoStreamState.STARTING to VideoStreamState.STREAMING,
        VideoStreamState.STARTING to VideoStreamState.IDLE,
        VideoStreamState.STREAMING to VideoStreamState.HOLD,
        VideoStreamState.HOLD to VideoStreamState.STREAMING,
        VideoStreamState.STREAMING to VideoStreamState.FLIPPING,
        VideoStreamState.FLIPPING to VideoStreamState.STREAMING,
        VideoStreamState.STREAMING to VideoStreamState.STOPPING,
        VideoStreamState.FLIPPING to VideoStreamState.STOPPING,
        VideoStreamState.HOLD to VideoStreamState.STOPPING,
        VideoStreamState.STOPPING to VideoStreamState.IDLE
    )

    @Test
    fun `canTransitionTo matches the documented transition table for all 36 state pairs`() {
        for (from in allStates) {
            for (to in allStates) {
                val expected = validTransitions.contains(from to to)
                assertEquals(
                    "canTransitionTo($from -> $to) expected $expected",
                    expected,
                    from.canTransitionTo(to)
                )
            }
        }
    }

    @Test
    fun `isActive is true for STREAMING, HOLD, and FLIPPING`() {
        assertTrue(VideoStreamState.STREAMING.isActive)
        assertTrue(VideoStreamState.HOLD.isActive)
        assertTrue(VideoStreamState.FLIPPING.isActive)
    }

    @Test
    fun `isActive is false for IDLE, STARTING, and STOPPING`() {
        assertFalse(VideoStreamState.IDLE.isActive)
        assertFalse(VideoStreamState.STARTING.isActive)
        assertFalse(VideoStreamState.STOPPING.isActive)
    }
}
