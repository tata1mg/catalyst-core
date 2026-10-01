package io.yourname.androidproject.utils

import android.content.Context
import org.junit.Assert.*
import org.junit.Test
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.io.path.createTempDirectory

/**
 * Unit tests for DownloadUtils (Android coverage batch 3), previously
 * entirely untested (0/114 lines).
 *
 * Context.cacheDir is mocked to a real temp directory, matching
 * OfflineCacheServiceTest/WebCacheManagerTest's established pattern.
 *
 * Deliberately out of scope: downloadFile/getRemoteFileSize (real
 * java.net network calls) and downloadFileWithCallback/
 * validateDownloadRequirements (both call downloadFile/getRemoteFileSize
 * internally, so exercising them meaningfully would require the same real
 * network dependency) -- consistent with this project's standing stance
 * (see WebCacheManagerTest's fetchAndCacheResourceBlocking note) against
 * mocking java.net deeply enough to test the mock instead of the code.
 * Covered instead: isValidUrl, extractFileNameFromUrl,
 * hasSufficientStorage, and cleanupDownloadedFiles -- all pure logic or
 * simple Context.cacheDir-backed file I/O.
 */
class DownloadUtilsTest {

    private lateinit var cacheDir: File
    private lateinit var context: Context

    private fun freshContext(cacheDirOverride: File = cacheDir): Context = mock {
        on { getCacheDir() } doReturn cacheDirOverride
    }

    @org.junit.Before
    fun setUp() {
        cacheDir = createTempDirectory(prefix = "catalyst-download-test").toFile()
        context = freshContext()
    }

    @org.junit.After
    fun tearDown() {
        cacheDir.deleteRecursively()
    }

    // ============================================================
    // isValidUrl
    // ============================================================

    @Test
    fun `isValidUrl accepts a well-formed http url`() {
        assertTrue(DownloadUtils.isValidUrl("http://example.com/file.pdf"))
    }

    @Test
    fun `isValidUrl accepts a well-formed https url`() {
        assertTrue(DownloadUtils.isValidUrl("https://example.com/file.pdf"))
    }

    @Test
    fun `isValidUrl rejects a blank url`() {
        assertFalse(DownloadUtils.isValidUrl(""))
        assertFalse(DownloadUtils.isValidUrl("   "))
    }

    @Test
    fun `isValidUrl rejects urls without http or https scheme`() {
        assertFalse(DownloadUtils.isValidUrl("ftp://example.com/file.pdf"))
        assertFalse(DownloadUtils.isValidUrl("file:///local/path"))
        assertFalse(DownloadUtils.isValidUrl("example.com/file.pdf"))
    }

    @Test
    fun `isValidUrl accepts a url with an empty host after the scheme`() {
        // Verified against the real java.net.URL parser: "https://" alone
        // parses successfully (an empty host is legal per the URL spec),
        // and a space in the host doesn't throw either -- java.net.URL is
        // far more lenient than the class's own KDoc ("throws if malformed")
        // implies. Since isValidUrl already gates on startsWith("http://")/
        // ("https://") before calling URL(...), there is no reachable input
        // that passes that prefix check yet still throws inside URL(...) --
        // the try/catch's catch branch is effectively unreachable for any
        // string this method is actually called with. This test documents
        // that finding rather than asserting a false-negative expectation.
        assertTrue(DownloadUtils.isValidUrl("https://"))
    }

    // ============================================================
    // extractFileNameFromUrl
    // ============================================================

    @Test
    fun `extractFileNameFromUrl returns the last path segment`() {
        assertEquals("file.pdf", DownloadUtils.extractFileNameFromUrl("https://example.com/path/to/file.pdf"))
    }

    @Test
    fun `extractFileNameFromUrl strips query parameters`() {
        assertEquals("file.pdf", DownloadUtils.extractFileNameFromUrl("https://example.com/file.pdf?token=abc123"))
    }

    @Test
    fun `extractFileNameFromUrl falls back to a default name when the path is empty`() {
        assertEquals("downloaded_file", DownloadUtils.extractFileNameFromUrl("https://example.com/"))
    }

    @Test
    fun `extractFileNameFromUrl with no path segment returns the host as the filename`() {
        // substringAfterLast("/") on "https://example.com" (no trailing
        // slash, no path) returns "example.com" -- the whole string after
        // the last "/" in the scheme separator itself. This is a real
        // quirk of the current implementation, not a bug this batch is
        // fixing; documented here rather than asserting the fallback that
        // only actually triggers when the path segment is present but
        // blank (covered by the trailing-slash case above).
        assertEquals("example.com", DownloadUtils.extractFileNameFromUrl("https://example.com"))
    }

    // ============================================================
    // hasSufficientStorage
    // ============================================================

    @Test
    fun `hasSufficientStorage returns true when free space comfortably exceeds the requirement`() {
        // Real temp dirs typically have plenty of free space on a CI/dev
        // machine; request a tiny amount to make this deterministic.
        assertTrue(DownloadUtils.hasSufficientStorage(context, requiredBytes = 1024L))
    }

    @Test
    fun `hasSufficientStorage returns false when required bytes exceed available free space`() {
        // File.freeSpace() reflects the real filesystem the temp dir lives
        // on -- request far more than any real disk has to force the
        // false branch deterministically rather than mocking File itself
        // (File is a concrete java.io class, not mockable via Context).
        val hugeRequirement = Long.MAX_VALUE / 2
        assertFalse(DownloadUtils.hasSufficientStorage(context, requiredBytes = hugeRequirement))
    }

    // ============================================================
    // cleanupDownloadedFiles
    // ============================================================

    @Test
    fun `cleanupDownloadedFiles does nothing when the downloaded_files dir does not exist`() {
        // No dir created -- should not throw.
        DownloadUtils.cleanupDownloadedFiles(context)
    }

    @Test
    fun `cleanupDownloadedFiles deletes files older than maxAgeMillis and keeps newer ones`() {
        val downloadDir = File(cacheDir, "downloaded_files")
        downloadDir.mkdirs()

        val oldFile = File(downloadDir, "old.pdf")
        oldFile.writeText("old content")
        val fourDaysAgo = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(4)
        oldFile.setLastModified(fourDaysAgo)

        val newFile = File(downloadDir, "new.pdf")
        newFile.writeText("new content")

        // Default maxAgeMillis is 3 days.
        DownloadUtils.cleanupDownloadedFiles(context)

        assertFalse("File older than 3 days should be deleted", oldFile.exists())
        assertTrue("Recently-modified file should survive cleanup", newFile.exists())
    }

    @Test
    fun `cleanupDownloadedFiles respects a custom maxAgeMillis`() {
        val downloadDir = File(cacheDir, "downloaded_files")
        downloadDir.mkdirs()

        val file = File(downloadDir, "recent.pdf")
        file.writeText("content")
        val oneHourAgo = System.currentTimeMillis() - TimeUnit.HOURS.toMillis(1)
        file.setLastModified(oneHourAgo)

        // maxAgeMillis of 30 minutes -- the 1-hour-old file should be
        // deleted even though it wouldn't be under the 3-day default.
        DownloadUtils.cleanupDownloadedFiles(context, maxAgeMillis = TimeUnit.MINUTES.toMillis(30))

        assertFalse(file.exists())
    }

    @Test
    fun `cleanupDownloadedFiles on an empty downloaded_files dir does not throw`() {
        val downloadDir = File(cacheDir, "downloaded_files")
        downloadDir.mkdirs()
        DownloadUtils.cleanupDownloadedFiles(context)
    }
}
