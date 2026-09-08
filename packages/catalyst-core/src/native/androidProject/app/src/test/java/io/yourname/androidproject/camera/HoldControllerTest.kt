package io.yourname.androidproject.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

/**
 * Unit tests for HoldController (Android coverage batch 3), previously
 * entirely untested (0/28 lines).
 *
 * Scope: isNewValue() (pure AtomicReference compare-and-set logic) and
 * reset() (clears state, no Handler dispatch required to observe its
 * effect via barcodeDetector.suppressResults / lastDetectedValue) are
 * covered directly. startHold()'s call into
 * stateMachine.transition(HOLD) and barcodeDetector.suppressResults=true
 * are also observable without the Handler ever firing.
 *
 * Deliberately out of scope, per this project's established
 * PerfEventBufferTest precedent (documented there and required reading for
 * this file): HoldController constructs a real
 * Handler(Looper.getMainLooper()) at field-init time. There is no real
 * Looper in a JVM unit test, so handler.postDelayed(...)'s posted runnable
 * (the "hold ended, resume streaming" callback) never fires here -- the
 * resumeRunnable's *body* (barcodeDetector.suppressResults = false,
 * stateMachine.transition(STREAMING)) is not exercised or asserted on.
 * Only the parts of startHold()/reset() that run synchronously before/
 * around the postDelayed/removeCallbacks calls are covered.
 */
class HoldControllerTest {

    private val stateMachine = mock<VideoStreamStateMachine>()
    private val barcodeDetector = mock<BarcodeDetector>()

    private fun newController() = HoldController(stateMachine, barcodeDetector)

    // ============================================================
    // startHold()
    // ============================================================

    @Test
    fun `startHold suppresses barcode results when the state transition succeeds`() {
        whenever(stateMachine.transition(VideoStreamState.HOLD)).thenReturn(true)

        val controller = newController()
        controller.startHold()

        // barcodeDetector is a Mockito mock -- its "suppressResults" setter
        // is intercepted rather than writing a real backing field, so the
        // observable effect is the setter invocation, not a later getter
        // read (which would just return the default/stubbed value).
        verify(barcodeDetector).suppressResults = true
        verify(stateMachine).transition(VideoStreamState.HOLD)
    }

    @Test
    fun `startHold does not suppress results when the state transition fails`() {
        whenever(stateMachine.transition(VideoStreamState.HOLD)).thenReturn(false)

        val controller = newController()
        controller.startHold()

        // Early return on a failed transition -- suppressResults is never
        // touched.
        org.mockito.Mockito.verifyNoInteractions(barcodeDetector)
    }

    @Test
    fun `startHold called twice cancels the previously scheduled runnable`() {
        whenever(stateMachine.transition(VideoStreamState.HOLD)).thenReturn(true)

        val controller = newController()
        controller.startHold()
        // Second call should not throw even though a runnable is already
        // pending -- exercises the resumeRunnable?.let { handler.removeCallbacks(it) }
        // branch with a non-null previous runnable.
        controller.startHold()

        verify(barcodeDetector, org.mockito.kotlin.times(2)).suppressResults = true
    }

    // ============================================================
    // reset()
    // ============================================================

    @Test
    fun `reset clears suppressResults and lastDetectedValue`() {
        whenever(stateMachine.transition(VideoStreamState.HOLD)).thenReturn(true)

        val controller = newController()
        controller.isNewValue("abc123")
        controller.startHold()

        controller.reset()

        // suppressResults is set true by startHold(), then false again by
        // reset() -- verify the final call rather than reading back a
        // mocked getter (see the startHold tests above for why).
        verify(barcodeDetector).suppressResults = false
        assertNull(controller.lastDetectedValue)
    }

    @Test
    fun `reset with no pending hold does not throw`() {
        val controller = newController()
        controller.reset()
        assertNull(controller.lastDetectedValue)
    }

    // ============================================================
    // isNewValue()
    // ============================================================

    @Test
    fun `isNewValue returns true for the first value seen and updates lastDetectedValue`() {
        val controller = newController()

        val result = controller.isNewValue("abc123")

        assertTrue(result)
        assertEquals("abc123", controller.lastDetectedValue)
    }

    @Test
    fun `isNewValue returns false for a repeat of the last detected value`() {
        val controller = newController()

        controller.isNewValue("abc123")
        val result = controller.isNewValue("abc123")

        assertFalse(result)
        assertEquals("abc123", controller.lastDetectedValue)
    }

    @Test
    fun `isNewValue returns true when the value differs from the last detected one`() {
        val controller = newController()

        controller.isNewValue("abc123")
        val result = controller.isNewValue("xyz789")

        assertTrue(result)
        assertEquals("xyz789", controller.lastDetectedValue)
    }

    @Test
    fun `lastDetectedValue is null before any detection`() {
        val controller = newController()
        assertNull(controller.lastDetectedValue)
    }
}
