package io.yourname.androidproject

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.MimeTypeMap
import io.yourname.androidproject.utils.FileUtils
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.MockedStatic
import org.mockito.Mockito.mockStatic
import org.mockito.kotlin.any
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.eq
import org.mockito.kotlin.isNull
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import java.io.ByteArrayInputStream
import kotlin.io.path.createTempDirectory

/**
 * Unit tests for FileUtils.
 *
 * The previous version of this file imported FileUtils but never called
 * a single method on it — assertions ran against a locally redefined
 * formatFileSize/MIME-lookup instead of the real class, so it passed
 * while contributing 0% coverage. Rewritten to call FileUtils directly,
 * following the mockStatic(...) + mocked Context/Cursor pattern
 * established in OfflineCacheServiceTest.kt.
 *
 * Base64 and MimeTypeMap are Android SDK statics with no real
 * implementation in a JVM unit test — mocked here so
 * convertUriToBase64/getMimeType exercise FileUtils' actual logic.
 */
class FileUtilsTest {

    private lateinit var cacheDir: java.io.File
    private lateinit var context: Context
    private lateinit var contentResolver: ContentResolver
    private lateinit var uri: Uri
    private lateinit var base64Mock: MockedStatic<Base64>

    @Before
    fun setUp() {
        cacheDir = createTempDirectory(prefix = "catalyst-fileutils-test").toFile()
        contentResolver = mock()
        context = mock {
            on { getContentResolver() } doReturn contentResolver
            on { getCacheDir() } doReturn cacheDir
        }
        uri = mock {
            on { toString() } doReturn "content://fake/file"
        }

        base64Mock = mockStatic(Base64::class.java)
        base64Mock.`when`<String> { Base64.encodeToString(any(), any()) }
            .thenAnswer { invocation ->
                val bytes = invocation.getArgument<ByteArray>(0)
                java.util.Base64.getEncoder().encodeToString(bytes)
            }
    }

    @After
    fun tearDown() {
        base64Mock.close()
        cacheDir.deleteRecursively()
    }

    private fun stubQueryCursor(name: String?, size: Long?) {
        val cursor: Cursor = mock {
            on { getColumnIndex(OpenableColumns.DISPLAY_NAME) } doReturn (if (name != null) 0 else -1)
            on { getColumnIndex(OpenableColumns.SIZE) } doReturn (if (size != null) 1 else -1)
            on { moveToFirst() } doReturn true
            on { getString(0) } doReturn name
            on { getLong(1) } doReturn (size ?: 0L)
        }
        whenever(contentResolver.query(eq(uri), isNull(), isNull(), isNull(), isNull())) doReturn cursor
    }

    // ============================================================
    // getFileSize
    // ============================================================

    @Test
    fun `getFileSize returns the size reported by the content resolver cursor`() {
        stubQueryCursor(name = "photo.jpg", size = 5242880L)
        assertEquals(5242880L, FileUtils.getFileSize(context, uri))
    }

    @Test
    fun `getFileSize returns 0 when the cursor has no SIZE column`() {
        stubQueryCursor(name = "photo.jpg", size = null)
        assertEquals(0L, FileUtils.getFileSize(context, uri))
    }

    @Test
    fun `getFileSize returns 0 when the query itself throws`() {
        whenever(contentResolver.query(eq(uri), isNull(), isNull(), isNull(), isNull()))
            .thenThrow(RuntimeException("boom"))
        assertEquals(0L, FileUtils.getFileSize(context, uri))
    }

    // ============================================================
    // getFileName / getDisplayName
    // ============================================================

    @Test
    fun `getFileName returns the display name reported by the cursor`() {
        stubQueryCursor(name = "report.pdf", size = 100L)
        assertEquals("report.pdf", FileUtils.getFileName(context, uri))
    }

    @Test
    fun `getFileName returns unknown_file when the cursor has no DISPLAY_NAME column`() {
        stubQueryCursor(name = null, size = 100L)
        assertEquals("unknown_file", FileUtils.getFileName(context, uri))
    }

    @Test
    fun `getDisplayName delegates to getFileName`() {
        stubQueryCursor(name = "vacation.png", size = 10L)
        assertEquals(FileUtils.getFileName(context, uri), FileUtils.getDisplayName(context, uri))
    }

    // ============================================================
    // getMimeType
    // ============================================================

    @Test
    fun `getMimeType returns the content resolver's reported type when present`() {
        whenever(contentResolver.getType(uri)) doReturn "image/png"
        assertEquals("image/png", FileUtils.getMimeType(context, uri))
    }

    @Test
    fun `getMimeType falls back to extension lookup when resolver has no type`() {
        whenever(contentResolver.getType(uri)) doReturn null
        stubQueryCursor(name = "document.pdf", size = 10L)

        val mimeTypeMap: MimeTypeMap = mock {
            on { getMimeTypeFromExtension("pdf") } doReturn "application/pdf"
        }
        val mimeTypeMapMock = mockStatic(MimeTypeMap::class.java)
        mimeTypeMapMock.`when`<MimeTypeMap> { MimeTypeMap.getSingleton() } doReturn mimeTypeMap
        try {
            assertEquals("application/pdf", FileUtils.getMimeType(context, uri))
        } finally {
            mimeTypeMapMock.close()
        }
    }

    @Test
    fun `getMimeType returns star-star when resolver throws`() {
        whenever(contentResolver.getType(uri)).thenThrow(RuntimeException("boom"))
        assertEquals("*/*", FileUtils.getMimeType(context, uri))
    }

    // ============================================================
    // convertUriToBase64
    // ============================================================

    @Test
    fun `convertUriToBase64 encodes the stream contents`() {
        val content = "hello world".toByteArray()
        whenever(contentResolver.openInputStream(uri)) doReturn ByteArrayInputStream(content)

        val result = FileUtils.convertUriToBase64(context, uri)

        assertEquals(java.util.Base64.getEncoder().encodeToString(content), result)
    }

    @Test
    fun `convertUriToBase64 returns null when the stream cannot be opened`() {
        whenever(contentResolver.openInputStream(uri)) doReturn null
        assertNull(FileUtils.convertUriToBase64(context, uri))
    }

    @Test
    fun `convertUriToBase64 returns null when opening the stream throws`() {
        whenever(contentResolver.openInputStream(uri)).thenThrow(RuntimeException("boom"))
        assertNull(FileUtils.convertUriToBase64(context, uri))
    }

    // ============================================================
    // cleanupTempFiles
    // ============================================================

    @Test
    fun `cleanupTempFiles deletes files older than maxAgeMillis under accessible_files`() {
        val accessibleDir = java.io.File(cacheDir, "accessible_files").apply { mkdirs() }
        val oldFile = java.io.File(accessibleDir, "temp_old.bin").apply {
            createNewFile()
            setLastModified(System.currentTimeMillis() - (48 * 60 * 60 * 1000L))
        }

        FileUtils.cleanupTempFiles(context, maxAgeMillis = 24 * 60 * 60 * 1000L)

        assertFalse(oldFile.exists())
    }

    @Test
    fun `cleanupTempFiles keeps files younger than maxAgeMillis`() {
        val accessibleDir = java.io.File(cacheDir, "accessible_files").apply { mkdirs() }
        val recentFile = java.io.File(accessibleDir, "temp_recent.bin").apply {
            createNewFile()
            setLastModified(System.currentTimeMillis() - (1 * 60 * 60 * 1000L))
        }

        FileUtils.cleanupTempFiles(context, maxAgeMillis = 24 * 60 * 60 * 1000L)

        assertTrue(recentFile.exists())
        recentFile.delete()
    }

    @Test
    fun `cleanupTempFiles does nothing when accessible_files does not exist`() {
        // No accessible_files dir created — should not throw.
        FileUtils.cleanupTempFiles(context, maxAgeMillis = 24 * 60 * 60 * 1000L)
    }

    // ============================================================
    // createTempFile
    // ============================================================

    @Test
    fun `createTempFile sanitizes unsafe characters from the filename`() {
        val file = FileUtils.createTempFile(context, "my file (final)!.txt")
        assertEquals("my_file__final__.txt", file.name)
        assertEquals("downloaded_files", file.parentFile?.name)
    }

    @Test
    fun `createTempFile respects a custom subDir`() {
        val file = FileUtils.createTempFile(context, "a.txt", subDir = "custom_dir")
        assertEquals("custom_dir", file.parentFile?.name)
    }

    // ============================================================
    // uriToFile
    // ============================================================

    @Test
    fun `uriToFile copies the stream into a real temp file`() {
        val content = "file contents".toByteArray()
        whenever(contentResolver.query(eq(uri), isNull(), isNull(), isNull(), isNull())) doReturn null
        whenever(contentResolver.openInputStream(uri)) doReturn ByteArrayInputStream(content)

        val result = FileUtils.uriToFile(context, uri)

        assertNotNull(result)
        assertTrue(result!!.exists())
        assertArrayEquals(content, result.readBytes())
        result.delete()
    }

    @Test
    fun `uriToFile returns null when opening the stream throws`() {
        whenever(contentResolver.query(eq(uri), isNull(), isNull(), isNull(), isNull())) doReturn null
        whenever(contentResolver.openInputStream(uri)).thenThrow(RuntimeException("boom"))

        assertNull(FileUtils.uriToFile(context, uri))
    }

    // ============================================================
    // detectMimeType (pure, no Context)
    // ============================================================

    @Test
    fun `detectMimeType resolves a known extension via MimeTypeMap`() {
        val mimeTypeMap: MimeTypeMap = mock {
            on { getMimeTypeFromExtension("jpg") } doReturn "image/jpeg"
        }
        val mimeTypeMapMock = mockStatic(MimeTypeMap::class.java)
        mimeTypeMapMock.`when`<MimeTypeMap> { MimeTypeMap.getSingleton() } doReturn mimeTypeMap
        try {
            assertEquals("image/jpeg", FileUtils.detectMimeType("/path/to/photo.jpg"))
        } finally {
            mimeTypeMapMock.close()
        }
    }

    @Test
    fun `detectMimeType falls back to star-star for an unrecognized extension`() {
        val mimeTypeMap: MimeTypeMap = mock {
            on { getMimeTypeFromExtension(any()) } doReturn null
        }
        val mimeTypeMapMock = mockStatic(MimeTypeMap::class.java)
        mimeTypeMapMock.`when`<MimeTypeMap> { MimeTypeMap.getSingleton() } doReturn mimeTypeMap
        try {
            assertEquals("*/*", FileUtils.detectMimeType("/path/to/file.unknownext"))
        } finally {
            mimeTypeMapMock.close()
        }
    }
}
