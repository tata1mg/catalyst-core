package io.yourname.androidproject

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Environment
import androidx.core.content.ContextCompat
import io.yourname.androidproject.utils.CameraUtils
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.MockedStatic
import org.mockito.Mockito.mockStatic
import org.mockito.kotlin.any
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import java.io.File
import kotlin.io.path.createTempDirectory

/**
 * Unit tests for CameraUtils.
 *
 * The previous version of this file imported CameraUtils but never called
 * a single method on it — every assertion was against hand-reimplemented
 * logic (a locally constructed SimpleDateFormat, a locally built filename
 * string) instead of the real class, so it passed while contributing 0%
 * coverage. Rewritten to call CameraUtils directly, following the
 * mockStatic(...) + mocked Activity pattern established in
 * OfflineCacheServiceTest.kt for Context/Android-stub-bound classes.
 *
 * ContextCompat.checkSelfPermission and Environment.getExternalStorageState
 * are static Android SDK calls with no real implementation in a JVM unit
 * test (the stub jar throws/returns defaults) — mocked statically here so
 * hasCameraPermission/getPermissionStatus/validateCameraRequirements
 * exercise CameraUtils' actual branching logic against controlled inputs.
 */
class CameraUtilsTest {

    private lateinit var activity: Activity
    private lateinit var picturesDir: File
    private lateinit var contextCompatMock: MockedStatic<ContextCompat>
    private lateinit var environmentMock: MockedStatic<Environment>

    @Before
    fun setUp() {
        picturesDir = createTempDirectory(prefix = "catalyst-camera-test").toFile()
        activity = mock {
            on { getExternalFilesDir(Environment.DIRECTORY_PICTURES) } doReturn picturesDir
        }

        contextCompatMock = mockStatic(ContextCompat::class.java)
        environmentMock = mockStatic(Environment::class.java)
        // getExternalStorageState() is a real method on the mocked static
        // Environment class object, not a constant — default to MOUNTED so
        // validateCameraRequirements' happy path is the default and tests
        // only override it for the failure case.
        environmentMock.`when`<String> { Environment.getExternalStorageState() }
            .thenReturn(Environment.MEDIA_MOUNTED)
    }

    @After
    fun tearDown() {
        contextCompatMock.close()
        environmentMock.close()
        picturesDir.deleteRecursively()
    }

    private fun stubPermission(granted: Boolean) {
        contextCompatMock.`when`<Int> { ContextCompat.checkSelfPermission(any(), any()) }
            .thenReturn(if (granted) PackageManager.PERMISSION_GRANTED else PackageManager.PERMISSION_DENIED)
    }

    // ============================================================
    // hasCameraPermission / getPermissionStatus
    // ============================================================

    @Test
    fun `hasCameraPermission returns true when ContextCompat reports granted`() {
        stubPermission(granted = true)
        assertTrue(CameraUtils.hasCameraPermission(activity))
    }

    @Test
    fun `hasCameraPermission returns false when ContextCompat reports denied`() {
        stubPermission(granted = false)
        assertFalse(CameraUtils.hasCameraPermission(activity))
    }

    @Test
    fun `getPermissionStatus returns GRANTED when permission is granted`() {
        stubPermission(granted = true)
        assertEquals("GRANTED", CameraUtils.getPermissionStatus(activity))
    }

    @Test
    fun `getPermissionStatus returns DENIED when permission is denied`() {
        stubPermission(granted = false)
        assertEquals("DENIED", CameraUtils.getPermissionStatus(activity))
    }

    // ============================================================
    // createImageFile
    // ============================================================

    @Test
    fun `createImageFile creates a real JPEG_ prefixed jpg file in the pictures dir`() {
        val file = CameraUtils.createImageFile(activity)

        assertTrue(file.exists())
        assertTrue(file.name.startsWith("JPEG_"))
        assertTrue(file.name.endsWith(".jpg"))
        assertEquals(picturesDir.canonicalPath, file.parentFile?.canonicalPath)

        file.delete()
    }

    @Test
    fun `createImageFile produces distinct files on successive calls`() {
        val file1 = CameraUtils.createImageFile(activity)
        val file2 = CameraUtils.createImageFile(activity)

        assertNotEquals(file1.name, file2.name)

        file1.delete()
        file2.delete()
    }

    // ============================================================
    // validateCameraRequirements
    // ============================================================

    @Test
    fun `validateCameraRequirements passes when device has a camera and storage is mounted`() {
        val packageManager = mock<PackageManager> {
            on { hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) } doReturn true
        }
        whenever(activity.packageManager) doReturn packageManager

        // Does not throw.
        CameraUtils.validateCameraRequirements(activity)
    }

    @Test
    fun `validateCameraRequirements throws when device has no camera`() {
        val packageManager = mock<PackageManager> {
            on { hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) } doReturn false
        }
        whenever(activity.packageManager) doReturn packageManager

        val error = assertThrows(IllegalStateException::class.java) {
            CameraUtils.validateCameraRequirements(activity)
        }
        assertEquals("Device does not have a camera", error.message)
    }

    @Test
    fun `validateCameraRequirements throws when external storage is not mounted`() {
        val packageManager = mock<PackageManager> {
            on { hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) } doReturn true
        }
        whenever(activity.packageManager) doReturn packageManager
        environmentMock.`when`<String> { Environment.getExternalStorageState() }
            .thenReturn(Environment.MEDIA_UNMOUNTED)

        val error = assertThrows(IllegalStateException::class.java) {
            CameraUtils.validateCameraRequirements(activity)
        }
        assertEquals("External storage not available", error.message)
    }

    // ============================================================
    // cleanupOldCameraFiles
    // ============================================================

    @Test
    fun `cleanupOldCameraFiles deletes files older than maxAgeMillis`() {
        val maxAge = 7 * 24 * 60 * 60 * 1000L
        val oldFile = File(picturesDir, "JPEG_20200101_000000_.jpg").apply {
            createNewFile()
            setLastModified(System.currentTimeMillis() - (10 * 24 * 60 * 60 * 1000L))
        }

        CameraUtils.cleanupOldCameraFiles(activity, maxAge)

        assertFalse(oldFile.exists())
    }

    @Test
    fun `cleanupOldCameraFiles keeps files younger than maxAgeMillis`() {
        val maxAge = 7 * 24 * 60 * 60 * 1000L
        val recentFile = File(picturesDir, "JPEG_20991231_235959_.jpg").apply {
            createNewFile()
            setLastModified(System.currentTimeMillis() - (1 * 24 * 60 * 60 * 1000L))
        }

        CameraUtils.cleanupOldCameraFiles(activity, maxAge)

        assertTrue(recentFile.exists())
        recentFile.delete()
    }

    @Test
    fun `cleanupOldCameraFiles ignores files not matching the JPEG_ prefix pattern`() {
        val maxAge = 7 * 24 * 60 * 60 * 1000L
        val unrelatedOldFile = File(picturesDir, "notes.txt").apply {
            createNewFile()
            setLastModified(System.currentTimeMillis() - (30 * 24 * 60 * 60 * 1000L))
        }

        CameraUtils.cleanupOldCameraFiles(activity, maxAge)

        assertTrue(unrelatedOldFile.exists())
        unrelatedOldFile.delete()
    }
}
