package io.yourname.androidproject.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for VideoStreamStateMachine, ported from iOS's
 * VideoStreamStateMachineTests.swift. Android's implementation uses
 * CopyOnWriteArrayList + @Synchronized rather than iOS's NSLock +
 * weak-listener boxing, so there's no weak-dealloc-compaction case to
 * port — everything else (valid/invalid transitions, listener
 * notify/no-notify, removeListener) carries over directly.
 */
class VideoStreamStateMachineTest {

    private class RecordingListener : VideoStreamStateListener {
        val events = mutableListOf<Pair<VideoStreamState, VideoStreamState>>()
        override fun onStateChanged(prev: VideoStreamState, next: VideoStreamState) {
            events.add(prev to next)
        }
    }

    @Test
    fun `a valid transition updates state and returns true`() {
        val machine = VideoStreamStateMachine()

        val result = machine.transition(VideoStreamState.STARTING)

        assertTrue(result)
        assertEquals(VideoStreamState.STARTING, machine.state)
    }

    @Test
    fun `an invalid transition leaves state unchanged and returns false`() {
        val machine = VideoStreamStateMachine()

        // IDLE -> STREAMING is not a valid direct transition.
        val result = machine.transition(VideoStreamState.STREAMING)

        assertFalse(result)
        assertEquals(VideoStreamState.IDLE, machine.state)
    }

    @Test
    fun `isActive reflects the current state`() {
        val machine = VideoStreamStateMachine()
        assertFalse(machine.isActive)

        machine.transition(VideoStreamState.STARTING)
        assertFalse(machine.isActive)

        machine.transition(VideoStreamState.STREAMING)
        assertTrue(machine.isActive)
    }

    @Test
    fun `a listener receives onStateChanged on a valid transition`() {
        val machine = VideoStreamStateMachine()
        val listener = RecordingListener()
        machine.addListener(listener)

        machine.transition(VideoStreamState.STARTING)

        assertEquals(listOf(VideoStreamState.IDLE to VideoStreamState.STARTING), listener.events)
    }

    @Test
    fun `a listener does not fire on an invalid transition`() {
        val machine = VideoStreamStateMachine()
        val listener = RecordingListener()
        machine.addListener(listener)

        machine.transition(VideoStreamState.STREAMING) // invalid from IDLE

        assertTrue(listener.events.isEmpty())
    }

    @Test
    fun `removeListener stops further notifications`() {
        val machine = VideoStreamStateMachine()
        val listener = RecordingListener()
        machine.addListener(listener)
        machine.transition(VideoStreamState.STARTING)
        assertEquals(1, listener.events.size)

        machine.removeListener(listener)
        machine.transition(VideoStreamState.STREAMING)

        // No new event recorded after removal.
        assertEquals(1, listener.events.size)
    }

    @Test
    fun `addListener does not register the same listener twice`() {
        val machine = VideoStreamStateMachine()
        val listener = RecordingListener()
        machine.addListener(listener)
        machine.addListener(listener)

        machine.transition(VideoStreamState.STARTING)

        assertEquals(1, listener.events.size)
    }

    @Test
    fun `multiple listeners all receive the same transition event`() {
        val machine = VideoStreamStateMachine()
        val listenerA = RecordingListener()
        val listenerB = RecordingListener()
        machine.addListener(listenerA)
        machine.addListener(listenerB)

        machine.transition(VideoStreamState.STARTING)

        assertEquals(1, listenerA.events.size)
        assertEquals(1, listenerB.events.size)
    }
}
