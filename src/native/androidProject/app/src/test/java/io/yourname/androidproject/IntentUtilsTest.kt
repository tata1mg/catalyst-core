package io.yourname.androidproject

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import io.yourname.androidproject.utils.IntentUtils
import org.junit.Assert.*
import org.junit.Test
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.doThrow
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever

/**
 * Unit tests for IntentUtils, previously entirely untested (0%).
 *
 * parseIntentParams/validateFileUrl/createFilePickerIntent are pure (no
 * Context/Activity) and covered directly. canHandleIntent/
 * getAppsForMimeType/getDefaultAppForMimeType take an Activity but only
 * touch its packageManager, so a mocked Activity + mocked PackageManager
 * covers them without FileProvider. openFileWithSystemIntent/
 * createShareIntent/openFileWithSpecificApp all call
 * FileProvider.getUriForFile — a static method backed by a real
 * ContentProvider registration that doesn't exist in a JVM unit test —
 * left uncovered here rather than chased with a heavier mocking setup;
 * matches the plan's "reachable without excessive mocking" scope.
 */
class IntentUtilsTest {

    // ============================================================
    // parseIntentParams
    // ============================================================

    @Test
    fun `parseIntentParams splits fileUrl and mimeType on the pipe delimiter`() {
        val (fileUrl, mimeType) = IntentUtils.parseIntentParams("https://example.com/file.pdf|application/pdf")
        assertEquals("https://example.com/file.pdf", fileUrl)
        assertEquals("application/pdf", mimeType)
    }

    @Test
    fun `parseIntentParams returns null mimeType when no pipe is present`() {
        val (fileUrl, mimeType) = IntentUtils.parseIntentParams("https://example.com/file.pdf")
        assertEquals("https://example.com/file.pdf", fileUrl)
        assertNull(mimeType)
    }

    @Test
    fun `parseIntentParams throws for null params`() {
        assertThrows(IllegalArgumentException::class.java) {
            IntentUtils.parseIntentParams(null)
        }
    }

    @Test
    fun `parseIntentParams throws for blank params`() {
        assertThrows(IllegalArgumentException::class.java) {
            IntentUtils.parseIntentParams("   ")
        }
    }

    @Test
    fun `parseIntentParams throws when the fileUrl portion is empty`() {
        assertThrows(IllegalArgumentException::class.java) {
            IntentUtils.parseIntentParams("|application/pdf")
        }
    }

    @Test
    fun `parseIntentParams treats a blank mimeType segment as null`() {
        val (_, mimeType) = IntentUtils.parseIntentParams("https://example.com/file.pdf|   ")
        assertNull(mimeType)
    }

    // ============================================================
    // validateFileUrl
    // ============================================================

    @Test
    fun `validateFileUrl accepts an https URL`() {
        IntentUtils.validateFileUrl("https://example.com/file.pdf")
    }

    @Test
    fun `validateFileUrl accepts an http URL`() {
        IntentUtils.validateFileUrl("http://example.com/file.pdf")
    }

    @Test
    fun `validateFileUrl throws for a blank URL`() {
        val error = assertThrows(IllegalArgumentException::class.java) {
            IntentUtils.validateFileUrl("")
        }
        assertEquals("File URL cannot be empty", error.message)
    }

    @Test
    fun `validateFileUrl throws for a non-http(s) scheme`() {
        val error = assertThrows(IllegalArgumentException::class.java) {
            IntentUtils.validateFileUrl("file:///local/path.pdf")
        }
        assertEquals("Only remote URLs (http/https) are supported", error.message)
    }

    // ============================================================
    // createFilePickerIntent
    //
    // Intent is a real android.content.Intent (not mocked) constructed
    // directly by the method under test. Its getters (action/type/
    // categories/getBooleanExtra/getStringArrayExtra) are backed by the
    // Android SDK's stub jar, which — even with
    // testOptions.unitTests.isReturnDefaultValues=true — returns default
    // values (null/false) rather than reflecting state actually set via
    // setAction()/type=/putExtra() on the same stub instance. That's a
    // structural limitation of testing raw Intent state in a plain JVM
    // unit test (Robolectric provides a real Intent implementation for
    // this; out of scope per this plan's Mockito-only ceiling). These
    // tests exercise the method's branching logic (single vs.
    // comma-separated MIME type path) and assert only that it completes
    // and returns a non-null Intent, not the Intent's resulting state.
    // ============================================================

    @Test
    fun `createFilePickerIntent returns a non-null Intent for a single MIME type`() {
        val intent = IntentUtils.createFilePickerIntent("application/pdf")
        assertNotNull(intent)
    }

    @Test
    fun `createFilePickerIntent returns a non-null Intent when allowMultiple is set`() {
        val intent = IntentUtils.createFilePickerIntent("image/*", allowMultiple = true)
        assertNotNull(intent)
    }

    @Test
    fun `createFilePickerIntent returns a non-null Intent for comma-separated MIME types`() {
        val intent = IntentUtils.createFilePickerIntent("application/pdf,image/png")
        assertNotNull(intent)
    }

    @Test
    fun `createFilePickerIntent returns a non-null Intent for a trailing-comma single type`() {
        val intent = IntentUtils.createFilePickerIntent("application/pdf,")
        assertNotNull(intent)
    }

    // ============================================================
    // canHandleIntent / getAppsForMimeType / getDefaultAppForMimeType
    // ============================================================

    private fun activityWithPackageManager(packageManager: PackageManager): Activity {
        return mock { on { getPackageManager() } doReturn packageManager }
    }

    @Test
    fun `canHandleIntent returns true when queryIntentActivities finds a match`() {
        val resolveInfo: ResolveInfo = mock()
        val packageManager: PackageManager = mock {
            on { queryIntentActivities(org.mockito.kotlin.any(), org.mockito.kotlin.eq(0)) } doReturn listOf(resolveInfo)
        }
        val activity = activityWithPackageManager(packageManager)

        assertTrue(IntentUtils.canHandleIntent(activity, Intent(Intent.ACTION_VIEW)))
    }

    @Test
    fun `canHandleIntent returns false when no app can handle it`() {
        val packageManager: PackageManager = mock {
            on { queryIntentActivities(org.mockito.kotlin.any(), org.mockito.kotlin.eq(0)) } doReturn emptyList()
        }
        val activity = activityWithPackageManager(packageManager)

        assertFalse(IntentUtils.canHandleIntent(activity, Intent(Intent.ACTION_VIEW)))
    }

    @Test
    fun `canHandleIntent returns false when queryIntentActivities throws`() {
        val packageManager: PackageManager = mock {
            on { queryIntentActivities(org.mockito.kotlin.any(), org.mockito.kotlin.eq(0)) } doThrow RuntimeException("boom")
        }
        val activity = activityWithPackageManager(packageManager)

        assertFalse(IntentUtils.canHandleIntent(activity, Intent(Intent.ACTION_VIEW)))
    }

    @Test
    fun `getAppsForMimeType returns loaded labels for each resolved app`() {
        val packageManager: PackageManager = mock()
        val resolveInfo: ResolveInfo = mock {
            on { loadLabel(packageManager) } doReturn "PDF Reader"
        }
        whenever(packageManager.queryIntentActivities(org.mockito.kotlin.any(), org.mockito.kotlin.eq(0)))
            .thenReturn(listOf(resolveInfo))
        val activity = activityWithPackageManager(packageManager)

        val apps = IntentUtils.getAppsForMimeType(activity, "application/pdf")

        assertEquals(listOf("PDF Reader"), apps)
    }

    @Test
    fun `getAppsForMimeType returns an empty list when resolution throws`() {
        val packageManager: PackageManager = mock {
            on { queryIntentActivities(org.mockito.kotlin.any(), org.mockito.kotlin.eq(0)) } doThrow RuntimeException("boom")
        }
        val activity = activityWithPackageManager(packageManager)

        assertTrue(IntentUtils.getAppsForMimeType(activity, "application/pdf").isEmpty())
    }

    @Test
    fun `getDefaultAppForMimeType returns the resolved package name`() {
        val resolveInfo = android.content.pm.ResolveInfo().apply {
            activityInfo = android.content.pm.ActivityInfo().apply { packageName = "com.example.pdf" }
        }
        val packageManager: PackageManager = mock {
            on { resolveActivity(org.mockito.kotlin.any(), org.mockito.kotlin.eq(0)) } doReturn resolveInfo
        }
        val activity = activityWithPackageManager(packageManager)

        assertEquals("com.example.pdf", IntentUtils.getDefaultAppForMimeType(activity, "application/pdf"))
    }

    @Test
    fun `getDefaultAppForMimeType returns null when nothing resolves`() {
        val packageManager: PackageManager = mock {
            on { resolveActivity(org.mockito.kotlin.any(), org.mockito.kotlin.eq(0)) } doReturn null
        }
        val activity = activityWithPackageManager(packageManager)

        assertNull(IntentUtils.getDefaultAppForMimeType(activity, "application/pdf"))
    }

    @Test
    fun `getDefaultAppForMimeType returns null when resolution throws`() {
        val packageManager: PackageManager = mock {
            on { resolveActivity(org.mockito.kotlin.any(), org.mockito.kotlin.eq(0)) } doThrow RuntimeException("boom")
        }
        val activity = activityWithPackageManager(packageManager)

        assertNull(IntentUtils.getDefaultAppForMimeType(activity, "application/pdf"))
    }
}
