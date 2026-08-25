package io.yourname.androidproject.camera

import android.animation.ValueAnimator
import android.content.Context
import androidx.camera.core.Camera
import androidx.camera.core.CameraControl
import androidx.camera.core.CameraInfo
import androidx.camera.core.ZoomState
import androidx.lifecycle.LiveData
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.MockedStatic
import org.mockito.Mockito.mockStatic
import org.mockito.kotlin.any
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

/**
 * Unit tests for ZoomController (Android coverage batch 4), previously
 * entirely untested (0/~79 lines).
 *
 * Constructor takes only a Context (to build a ScaleGestureDetector) plus
 * a VideoStreamStateMachine and a callback -- all safe to construct
 * because the mockable android.jar strips Android constructors to no-ops.
 * The ScaleGestureDetector-driven pinch-to-zoom path (onTouchEvent /
 * SimpleOnScaleGestureListener.onScale) is NOT exercised here: it requires
 * a real ScaleGestureDetector to actually parse a MotionEvent stream and
 * invoke the listener, which the mockable jar's stub GestureDetector does
 * not do -- there is no seam to inject a fake detector (it's a private val
 * built in the constructor). That gap mirrors this project's established
 * precedent of leaving Android-internal event-dispatch machinery
 * unexercised (see HoldControllerTest's Handler/Looper note) rather than
 * pulling in Robolectric.
 *
 * Covered instead: applyZoomMultiplier() (no-camera / no-zoomState guards
 * and the real clamp+setZoomRatio+callback path), onAutoZoomSuggestion()'s
 * zoom-only-up guard, debounce/confirm-frame counting, and the animated
 * commit branch, cancelZoomAnimation(), and currentMaxZoomRatio().
 *
 * ValueAnimator.ofFloat(...) returns null under the mockable jar (a static
 * factory method, same shape as MetricsMonitorTest's
 * Choreographer.getInstance() problem) -- mockStatic(ValueAnimator) is
 * installed for the animated-commit tests and closed in tearDown(),
 * stubbing ofFloat(...) to return a mocked ValueAnimator so
 * onAutoZoomSuggestion()'s `.apply { ... start() }` block and the
 * addUpdateListener(...) callback body are both exercisable by manually
 * invoking the captured listener, mirroring TorchControllerTest's
 * captured-Runnable pattern.
 */
class ZoomControllerTest {

    private lateinit var valueAnimatorMock: MockedStatic<ValueAnimator>
    private val context = mock<Context>()
    private val stateMachine = mock<VideoStreamStateMachine>()

    private val zoomEvents = mutableListOf<Triple<Float, Float, Float>>()
    private fun onZoomChanged(zoomLevel: Float, minZoom: Float, maxZoom: Float) {
        zoomEvents.add(Triple(zoomLevel, minZoom, maxZoom))
    }

    private fun newController() = ZoomController(context, stateMachine, ::onZoomChanged)

    @Before
    fun setUp() {
        zoomEvents.clear()
    }

    @After
    fun tearDown() {
        if (::valueAnimatorMock.isInitialized) {
            valueAnimatorMock.close()
        }
    }

    private fun mockCamera(zoomRatio: Float, minZoom: Float, maxZoom: Float): Camera {
        val zoomState = mock<ZoomState> {
            on { getZoomRatio() } doReturn zoomRatio
            on { getMinZoomRatio() } doReturn minZoom
            on { getMaxZoomRatio() } doReturn maxZoom
        }
        @Suppress("UNCHECKED_CAST")
        val zoomStateLiveData = mock<LiveData<ZoomState>> {
            on { getValue() } doReturn zoomState
        }
        val cameraInfo = mock<CameraInfo> {
            on { getZoomState() } doReturn zoomStateLiveData
        }
        val cameraControl = mock<CameraControl>()
        return mock {
            on { getCameraInfo() } doReturn cameraInfo
            on { getCameraControl() } doReturn cameraControl
        }
    }

    // ============================================================
    // applyZoomMultiplier
    // ============================================================

    @Test
    fun `applyZoomMultiplier with no camera attached is a no-op`() {
        val controller = newController()

        controller.applyZoomMultiplier(2.0f)

        assertTrue(zoomEvents.isEmpty())
    }

    @Test
    fun `applyZoomMultiplier with a null zoomState value is a no-op`() {
        val zoomStateLiveData = mock<LiveData<ZoomState>>()
        whenever(zoomStateLiveData.value).thenReturn(null)
        val cameraInfo = mock<CameraInfo> {
            on { getZoomState() } doReturn zoomStateLiveData
        }
        val camera = mock<Camera> { on { getCameraInfo() } doReturn cameraInfo }
        val controller = newController()
        controller.attachCamera(camera)

        controller.applyZoomMultiplier(2.0f)

        assertTrue(zoomEvents.isEmpty())
    }

    @Test
    fun `applyZoomMultiplier clamps to maxZoomRatio and fires the callback`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 5.0f)
        val controller = newController()
        controller.attachCamera(camera)

        controller.applyZoomMultiplier(10.0f)

        verify(camera.cameraControl).setZoomRatio(5.0f)
        assertEquals(listOf(Triple(5.0f, 1.0f, 5.0f)), zoomEvents)
    }

    @Test
    fun `applyZoomMultiplier clamps to minZoomRatio when below range`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 5.0f)
        val controller = newController()
        controller.attachCamera(camera)

        controller.applyZoomMultiplier(0.1f)

        verify(camera.cameraControl).setZoomRatio(1.0f)
        assertEquals(listOf(Triple(1.0f, 1.0f, 5.0f)), zoomEvents)
    }

    @Test
    fun `applyZoomMultiplier within range passes the multiplier through unchanged`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 5.0f)
        val controller = newController()
        controller.attachCamera(camera)

        controller.applyZoomMultiplier(3.0f)

        verify(camera.cameraControl).setZoomRatio(3.0f)
        assertEquals(listOf(Triple(3.0f, 1.0f, 5.0f)), zoomEvents)
    }

    @Test
    fun `setZoom delegates to applyZoomMultiplier`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 5.0f)
        val controller = newController()
        controller.attachCamera(camera)

        controller.setZoom(2.0f)

        verify(camera.cameraControl).setZoomRatio(2.0f)
        assertEquals(listOf(Triple(2.0f, 1.0f, 5.0f)), zoomEvents)
    }

    // ============================================================
    // detachCamera
    // ============================================================

    @Test
    fun `detachCamera clears the camera so subsequent zoom calls are no-ops`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 5.0f)
        val controller = newController()
        controller.attachCamera(camera)

        controller.detachCamera()
        controller.applyZoomMultiplier(2.0f)

        assertTrue(zoomEvents.isEmpty())
    }

    // ============================================================
    // onAutoZoomSuggestion -- guards
    // ============================================================

    @Test
    fun `onAutoZoomSuggestion with no camera attached returns false`() {
        val controller = newController()

        val result = controller.onAutoZoomSuggestion(3.0f)

        assertFalse(result)
        assertTrue(zoomEvents.isEmpty())
    }

    @Test
    fun `onAutoZoomSuggestion ignores a suggestion that would zoom out`() {
        val camera = mockCamera(zoomRatio = 3.0f, minZoom = 1.0f, maxZoom = 8.0f)
        val controller = newController()
        controller.attachCamera(camera)

        val result = controller.onAutoZoomSuggestion(2.0f)

        assertFalse(result)
        assertTrue(zoomEvents.isEmpty())
    }

    @Test
    fun `onAutoZoomSuggestion ignores a suggestion equal to the current ratio`() {
        val camera = mockCamera(zoomRatio = 3.0f, minZoom = 1.0f, maxZoom = 8.0f)
        val controller = newController()
        controller.attachCamera(camera)

        val result = controller.onAutoZoomSuggestion(3.0f)

        assertFalse(result)
    }

    // ============================================================
    // onAutoZoomSuggestion -- debounce
    // ============================================================

    @Test
    fun `onAutoZoomSuggestion requires two consecutive matching frames before committing`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 8.0f)
        val controller = newController()
        controller.attachCamera(camera)

        val firstFrame = controller.onAutoZoomSuggestion(4.0f)
        assertFalse("first frame should only start debounce, not commit", firstFrame)
        assertTrue(zoomEvents.isEmpty())
    }

    @Test
    fun `onAutoZoomSuggestion resets debounce when the target changes beyond tolerance`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 8.0f)
        val controller = newController()
        controller.attachCamera(camera)

        controller.onAutoZoomSuggestion(4.0f)
        // Jumps well outside SUGGESTION_TOLERANCE (0.1f) -- restarts the
        // debounce counter at 1 rather than confirming.
        val secondFrame = controller.onAutoZoomSuggestion(6.0f)

        assertFalse(secondFrame)
    }

    @Test
    fun `onAutoZoomSuggestion resets debounce after a zoom-out-guard rejection`() {
        val camera = mockCamera(zoomRatio = 3.0f, minZoom = 1.0f, maxZoom = 8.0f)
        val controller = newController()
        controller.attachCamera(camera)

        // First build up one confirm frame toward 5.0.
        controller.onAutoZoomSuggestion(5.0f)
        // Now a rejected (zoom-out) suggestion resets consecutiveSuggestionCount to 0.
        controller.onAutoZoomSuggestion(2.0f)

        valueAnimatorMock = mockStatic(ValueAnimator::class.java)
        val animator = mock<ValueAnimator>()
        valueAnimatorMock.`when`<ValueAnimator> { ValueAnimator.ofFloat(any(), any()) }.thenReturn(animator)

        // Suggesting 5.0 again should require a fresh two-frame confirm,
        // not just one more (proving the counter was actually reset).
        val secondAttemptFirstFrame = controller.onAutoZoomSuggestion(5.0f)
        assertFalse("counter should have been reset by the rejected suggestion", secondAttemptFirstFrame)
    }

    // ============================================================
    // onAutoZoomSuggestion -- confirmed / animated commit
    // ============================================================

    @Test
    fun `onAutoZoomSuggestion commits and animates after enough consecutive matching frames`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 8.0f)
        val controller = newController()
        controller.attachCamera(camera)

        valueAnimatorMock = mockStatic(ValueAnimator::class.java)
        val animator = mock<ValueAnimator>()
        valueAnimatorMock.`when`<ValueAnimator> { ValueAnimator.ofFloat(1.0f, 4.0f) }.thenReturn(animator)

        controller.onAutoZoomSuggestion(4.0f) // frame 1 -- debounce only
        val committed = controller.onAutoZoomSuggestion(4.0f) // frame 2 -- confirmed

        assertTrue(committed)
        verify(animator).duration = 300L
        verify(animator).start()

        val listenerCaptor = argumentCaptor<ValueAnimator.AnimatorUpdateListener>()
        verify(animator).addUpdateListener(listenerCaptor.capture())

        // Manually invoke the captured update listener, as TorchControllerTest
        // does for its captured Runnable -- there's no real animation loop
        // ticking a mocked ValueAnimator in a JVM unit test.
        val tickingAnimator = mock<ValueAnimator> { on { getAnimatedValue() } doReturn 2.5f }
        listenerCaptor.firstValue.onAnimationUpdate(tickingAnimator)

        verify(camera.cameraControl).setZoomRatio(2.5f)
        assertTrue(zoomEvents.contains(Triple(2.5f, 1.0f, 8.0f)))
    }

    @Test
    fun `onAutoZoomSuggestion cancels a prior in-flight animator before starting a new one`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 8.0f)
        val controller = newController()
        controller.attachCamera(camera)

        valueAnimatorMock = mockStatic(ValueAnimator::class.java)
        val firstAnimator = mock<ValueAnimator>()
        val secondAnimator = mock<ValueAnimator>()
        valueAnimatorMock.`when`<ValueAnimator> { ValueAnimator.ofFloat(any(), any()) }
            .thenReturn(firstAnimator, secondAnimator)

        controller.onAutoZoomSuggestion(4.0f)
        controller.onAutoZoomSuggestion(4.0f) // commits firstAnimator

        controller.onAutoZoomSuggestion(7.0f)
        controller.onAutoZoomSuggestion(7.0f) // commits secondAnimator, should cancel firstAnimator first

        verify(firstAnimator).cancel()
    }

    // ============================================================
    // cancelZoomAnimation
    // ============================================================

    @Test
    fun `cancelZoomAnimation with no active animator does not throw`() {
        val controller = newController()

        controller.cancelZoomAnimation()
    }

    @Test
    fun `cancelZoomAnimation cancels an in-flight animator and resets debounce state`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 8.0f)
        val controller = newController()
        controller.attachCamera(camera)

        valueAnimatorMock = mockStatic(ValueAnimator::class.java)
        val animator = mock<ValueAnimator>()
        valueAnimatorMock.`when`<ValueAnimator> { ValueAnimator.ofFloat(any(), any()) }.thenReturn(animator)

        controller.onAutoZoomSuggestion(4.0f)
        controller.onAutoZoomSuggestion(4.0f) // commits and starts `animator`

        controller.cancelZoomAnimation()

        verify(animator).cancel()

        // Debounce state was reset -- a fresh suggestion needs two frames again.
        val nextFirstFrame = controller.onAutoZoomSuggestion(4.0f)
        assertFalse(nextFirstFrame)
    }

    @Test
    fun `detachCamera also cancels any in-flight zoom animation`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 8.0f)
        val controller = newController()
        controller.attachCamera(camera)

        valueAnimatorMock = mockStatic(ValueAnimator::class.java)
        val animator = mock<ValueAnimator>()
        valueAnimatorMock.`when`<ValueAnimator> { ValueAnimator.ofFloat(any(), any()) }.thenReturn(animator)

        controller.onAutoZoomSuggestion(4.0f)
        controller.onAutoZoomSuggestion(4.0f)

        controller.detachCamera()

        verify(animator).cancel()
    }

    // ============================================================
    // currentMaxZoomRatio
    // ============================================================

    @Test
    fun `currentMaxZoomRatio returns the default 8x when no camera is attached`() {
        val controller = newController()

        assertEquals(8.0f, controller.currentMaxZoomRatio(), 0.001f)
    }

    @Test
    fun `currentMaxZoomRatio returns the default 8x when zoomState value is null`() {
        val zoomStateLiveData = mock<LiveData<ZoomState>>()
        whenever(zoomStateLiveData.value).thenReturn(null)
        val cameraInfo = mock<CameraInfo> {
            on { getZoomState() } doReturn zoomStateLiveData
        }
        val camera = mock<Camera> { on { getCameraInfo() } doReturn cameraInfo }
        val controller = newController()
        controller.attachCamera(camera)

        assertEquals(8.0f, controller.currentMaxZoomRatio(), 0.001f)
    }

    @Test
    fun `currentMaxZoomRatio returns the attached camera's maxZoomRatio`() {
        val camera = mockCamera(zoomRatio = 1.0f, minZoom = 1.0f, maxZoom = 12.5f)
        val controller = newController()
        controller.attachCamera(camera)

        assertEquals(12.5f, controller.currentMaxZoomRatio(), 0.001f)
    }
}
