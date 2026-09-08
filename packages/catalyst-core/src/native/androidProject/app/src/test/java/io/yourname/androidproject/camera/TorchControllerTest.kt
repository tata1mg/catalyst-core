package io.yourname.androidproject.camera

import android.content.Context
import androidx.camera.core.Camera
import androidx.camera.core.CameraControl
import com.google.common.util.concurrent.ListenableFuture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

/**
 * Unit tests for TorchController (Android coverage batch 3), previously
 * entirely untested (0/26 lines).
 *
 * Scope: attachCamera/detachCamera (pure field assignment) and setTorch's
 * three branches (no camera attached, front-camera guard, and the actual
 * enableTorch(...).addListener(...) call on a mocked Camera/CameraControl/
 * ListenableFuture) are all covered without needing a real CameraX
 * pipeline -- Camera/CameraControl are interfaces and ListenableFuture is
 * a plain interface too, all mockable. notifyReset() is pure (invokes the
 * callback, logs).
 *
 * ContextCompat.getMainExecutor(context) is called with a mocked Context;
 * per DownloadUtilsTest/OfflineCacheServiceTest precedent, no
 * mockStatic(ContextCompat) is needed here -- getMainExecutor() on a
 * plain mocked Context under the mockable android.jar
 * (isReturnDefaultValues=true / Robolectric not in use) still needs a
 * Looper to resolve on a real device, but in this project's JVM-mock
 * setup, ContextCompat.getMainExecutor() ultimately just wraps
 * context.getMainLooper(); a mocked Context's getMainLooper() returns
 * null under the mockable jar's default-value stubbing. Since the
 * listener is added to the ListenableFuture's addListener(Runnable,
 * Executor) directly and we intercept that call on a mocked
 * ListenableFuture (never a real Guava future backed by the executor),
 * the executor value itself is never actually invoked/dereferenced here
 * -- only that setTorch reaches the addListener call and, when we
 * manually invoke the captured Runnable, that onTorchChanged fires.
 */
class TorchControllerTest {

    private val context = mock<Context>()

    // ============================================================
    // attachCamera / detachCamera
    // ============================================================

    @Test
    fun `attachCamera then detachCamera does not throw`() {
        val callback = mutableListOf<Boolean>()
        val controller = TorchController(context) { callback.add(it) }
        val camera = mock<Camera>()

        controller.attachCamera(camera, "back")
        controller.detachCamera()

        assertNotNull(controller)
    }

    // ============================================================
    // setTorch
    // ============================================================

    @Test
    fun `setTorch with no camera attached does not throw and does not invoke callback`() {
        val callback = mutableListOf<Boolean>()
        val controller = TorchController(context) { callback.add(it) }

        controller.setTorch(true)

        assertTrue(callback.isEmpty())
    }

    @Test
    fun `setTorch on a front-facing camera is ignored`() {
        val callback = mutableListOf<Boolean>()
        val controller = TorchController(context) { callback.add(it) }
        val camera = mock<Camera>()
        controller.attachCamera(camera, "front")

        controller.setTorch(true)

        assertTrue(callback.isEmpty())
        org.mockito.Mockito.verifyNoInteractions(camera)
    }

    @Test
    fun `setTorch on a back-facing camera enables torch and fires the callback once the future resolves`() {
        val callback = mutableListOf<Boolean>()
        val controller = TorchController(context) { callback.add(it) }
        val camera = mock<Camera>()
        val cameraControl = mock<CameraControl>()
        @Suppress("UNCHECKED_CAST")
        val future = mock<ListenableFuture<Void>>()
        whenever(camera.cameraControl).doReturn(cameraControl)
        whenever(cameraControl.enableTorch(true)).doReturn(future)
        controller.attachCamera(camera, "back")

        controller.setTorch(true)

        // Capture the Runnable passed to addListener and invoke it
        // manually -- there's no real Looper/Executor running the
        // listener for us in a JVM unit test.
        val runnableCaptor = argumentCaptor<Runnable>()
        verify(future).addListener(runnableCaptor.capture(), any())
        runnableCaptor.firstValue.run()

        assertEquals(listOf(true), callback)
    }

    @Test
    fun `setTorch(false) disables torch`() {
        val callback = mutableListOf<Boolean>()
        val controller = TorchController(context) { callback.add(it) }
        val camera = mock<Camera>()
        val cameraControl = mock<CameraControl>()
        val future = mock<ListenableFuture<Void>>()
        whenever(camera.cameraControl).doReturn(cameraControl)
        whenever(cameraControl.enableTorch(false)).doReturn(future)
        controller.attachCamera(camera, "back")

        controller.setTorch(false)

        val runnableCaptor = argumentCaptor<Runnable>()
        verify(future).addListener(runnableCaptor.capture(), any())
        runnableCaptor.firstValue.run()

        assertEquals(listOf(false), callback)
    }

    // ============================================================
    // notifyReset
    // ============================================================

    @Test
    fun `notifyReset invokes the callback with false`() {
        val callback = mutableListOf<Boolean>()
        val controller = TorchController(context) { callback.add(it) }

        controller.notifyReset()

        assertEquals(listOf(false), callback)
    }
}
