package io.catalyst.nativeai

import java.io.File
import java.io.IOException
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

// iOS equivalent: Support/ResumableDownload.swift. Keep the two in step.
//
// Resumable model download. A ~2.6 GB model that dies at 90% must not start over: the partial file and the server's
// ETag stay on disk, and the next attempt asks for the rest with `Range` + `If-Range`. If the file changed upstream,
// `If-Range` makes the server send the whole thing again and the partial is replaced, never spliced.

/** The decisions, kept free of I/O. */
internal object ResumeRules {
    data class Resume(val offset: Long, val etag: String)

    sealed class Outcome {
        /** 206 at the offset we asked for: append; [total] is the full file size. */
        data class Append(val total: Long) : Outcome()
        /** 200: the server sent the whole file (it ignored Range, or the file changed). Replace the partial. */
        data class Truncate(val total: Long) : Outcome()
        /** 416 and the partial already is the whole file. */
        object Complete : Outcome()
        /** The partial cannot be continued (bad Content-Range, 416 on a different size): delete it and ask again. */
        object Restart : Outcome()
        data class Fail(val status: Int) : Outcome()
    }

    data class ContentRange(val start: Long?, val end: Long?, val total: Long?)

    /** Resume only with proof of which bytes the partial holds: some data and a strong ETag (If-Range ignores weak ones). */
    fun plan(partialSize: Long, storedETag: String?): Resume? {
        val etag = storedETag?.trim()
        if (partialSize <= 0 || etag.isNullOrEmpty() || etag.startsWith("W/")) return null
        return Resume(partialSize, etag)
    }

    fun isStrong(etag: String?): Boolean {
        val e = etag?.trim()
        return !e.isNullOrEmpty() && !e.startsWith("W/")
    }

    // `bytes 100-499/500` -> (100, 499, 500); an unsatisfied range, `bytes` then a star, slash and the size, -> (null, null, size).
    // (Kept as a line comment: a star-slash inside a block comment would end it.)
    fun parseContentRange(header: String?): ContentRange? {
        val h = header?.trim() ?: return null
        if (!h.lowercase().startsWith("bytes ")) return null
        val spec = h.substring("bytes ".length).split("/")
        if (spec.size != 2) return null
        val total = spec[1].toLongOrNull()
        if (spec[0] == "*") return ContentRange(null, null, total)
        val range = spec[0].split("-")
        if (range.size != 2) return null
        val start = range[0].toLongOrNull() ?: return null
        val end = range[1].toLongOrNull() ?: return null
        return if (start <= end) ContentRange(start, end, total) else null
    }

    /**
     * [offset] is where we asked to resume (0 when we sent no Range). [expectedETag] is the validator the partial was
     * downloaded under, [etag] what this response carries.
     *
     * `If-Range` is not enough to protect a resume: Hugging Face's CDN ignores it and answers 206 whatever validator
     * is sent (checked with curl against the real host), so a file that changed upstream would be spliced onto the
     * old bytes. The response's own ETag is compared instead, and a missing or different one restarts.
     */
    fun interpret(
        status: Int,
        offset: Long,
        contentRange: String?,
        contentLength: Long?,
        etag: String? = null,
        expectedETag: String? = null,
    ): Outcome {
        val range = parseContentRange(contentRange)
        return when (status) {
            206 -> {
                val total = range?.total
                when {
                    !(offset > 0 && range?.start == offset && total != null && total > offset) -> Outcome.Restart
                    expectedETag != null && etag?.trim() != expectedETag -> Outcome.Restart
                    else -> Outcome.Append(total)
                }
            }
            200 -> Outcome.Truncate(if (contentLength != null && contentLength > 0) contentLength else -1L)
            416 -> if (offset > 0 && range?.total == offset) Outcome.Complete else Outcome.Restart
            else -> Outcome.Fail(status)
        }
    }
}

/** [discardPartial]: true when keeping the partial cannot help (client error, corrupt size); false for network trouble and 5xx. */
internal class DownloadException(message: String, val discardPartial: Boolean, val transient: Boolean = false) : Exception(message)

internal class ResumableDownloader(
    private val userAgent: String,
    private val connectTimeoutMs: Int = 30_000,
    // The read timeout is the idle limit: no bytes for this long fails the transfer (a stalled link delivers no chunks
    // to measure). With a policy it follows the policy's window.
    private val readTimeoutMs: Int = 60_000,
    private val policy: DownloadPolicy? = null,
    private val gate: DownloadGate? = null,
    private val log: (String) -> Unit = {},
    private val onBytes: (loaded: Long, total: Long) -> Unit = { _, _ -> },
) {
    @Volatile private var interruption: DownloadInterrupted.Kind? = null

    private sealed class Attempt {
        data class Done(val total: Long) : Attempt()
        object Restart : Attempt()
    }

    /**
     * Downloads into [partial] and returns its final size, verified against what the server announced.
     * On failure the partial is kept for the next attempt unless it is known to be useless.
     */
    fun download(url: String, partial: File, etagFile: File): Long {
        var total = -1L
        var restarted = false
        for (attempt in 0..1) {
            interruption = null
            // A pause that arrived between attempts is honoured before any bytes are requested.
            gate?.pausedReason?.let { throw DownloadInterrupted(DownloadInterrupted.Kind.Paused(it)) }
            val resume = ResumeRules.plan(if (partial.exists()) partial.length() else 0L, readETag(etagFile))
            if (resume == null) discard(partial, etagFile)
            if (resume != null) log("Resuming download at ${resume.offset / 1_000_000}MB")
            when (val result = runAttempt(url, partial, etagFile, resume)) {
                is Attempt.Done -> { total = result.total; restarted = false }
                Attempt.Restart -> {
                    restarted = true
                    if (attempt == 0) {
                        log("Partial download cannot be continued; starting over")
                        discard(partial, etagFile)
                        continue
                    }
                }
            }
            break
        }
        if (restarted) throw DownloadException("Server would not serve the model", discardPartial = true)

        val size = if (partial.exists()) partial.length() else 0L
        if (size == 0L) throw DownloadException("Downloaded file is empty", discardPartial = true)
        // Short: the connection ended early, keep it and resume. Long: it can only be wrong.
        if (total > 0 && size != total) {
            throw DownloadException("Download incomplete ($size of $total bytes)", discardPartial = size > total, transient = size < total)
        }
        return size
    }

    fun discard(partial: File, etagFile: File) {
        partial.delete()
        etagFile.delete()
    }

    private fun readETag(file: File): String? = try { if (file.exists()) file.readText() else null } catch (e: Exception) { null }

    private fun runAttempt(url: String, partial: File, etagFile: File, resume: ResumeRules.Resume?): Attempt {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = connectTimeoutMs
            readTimeout = policy?.let { (it.windowSec * 1000).toInt() } ?: readTimeoutMs
            setRequestProperty("User-Agent", userAgent)
            // Ranges address the bytes on the wire; never let a transfer encoding change what they mean.
            setRequestProperty("Accept-Encoding", "identity")
            if (resume != null) {
                setRequestProperty("Range", "bytes=${resume.offset}-")
                setRequestProperty("If-Range", resume.etag)
            }
            instanceFollowRedirects = true
        }
        // A pause from the page interrupts the transfer in flight: closing the connection ends the blocked read.
        gate?.setPauseHandler { reason ->
            if (interruption == null) interruption = DownloadInterrupted.Kind.Paused(reason)
            conn.disconnect()
        }
        try {
            conn.connect()
            val status = conn.responseCode
            val offset = resume?.offset ?: 0L
            val length = conn.contentLengthLong.takeIf { it > 0 }
            val etag = conn.getHeaderField("ETag")
            val append: Boolean
            val total: Long
            val base: Long
            when (val outcome = ResumeRules.interpret(status, offset, conn.getHeaderField("Content-Range"), length, etag, resume?.etag)) {
                is ResumeRules.Outcome.Append -> { append = true; total = outcome.total; base = offset }
                is ResumeRules.Outcome.Truncate -> {
                    if (offset > 0) log("Server sent the whole file; replacing the partial")
                    append = false; total = outcome.total; base = 0L
                }
                ResumeRules.Outcome.Complete -> return Attempt.Done(offset)
                ResumeRules.Outcome.Restart -> return Attempt.Restart
                is ResumeRules.Outcome.Fail ->
                    throw DownloadException(
                        "HTTP ${outcome.status} from model server",
                        discardPartial = outcome.status in 400..499,
                        transient = outcome.status >= 500 || outcome.status == 429,
                    )
            }

            if (ResumeRules.isStrong(etag)) etagFile.writeText(etag!!) else etagFile.delete()
            var loaded = base
            val window = policy?.let { ThroughputWindow(it.minBytesPerSec, it.windowSec) }
            conn.inputStream.use { input ->
                FileOutputStream(partial, append).use { output ->
                    val buf = ByteArray(128 * 1024)
                    while (true) {
                        val n = try {
                            input.read(buf)
                        } catch (e: IOException) {
                            // A pause closed the connection under the read: report why, not a socket error.
                            interruption?.let { throw DownloadInterrupted(it) }
                            throw e
                        }
                        if (n == -1) break
                        try {
                            output.write(buf, 0, n)
                        } catch (e: IOException) {
                            throw DownloadException("Could not write the model: ${e.message}", discardPartial = false)
                        }
                        loaded += n
                        onBytes(loaded, total)
                        val verdict = window?.record(n.toLong())
                        if (verdict is ThroughputWindow.Verdict.Weak) throw DownloadInterrupted(DownloadInterrupted.Kind.Weak(verdict.bytesPerSec))
                    }
                }
            }
            return Attempt.Done(total)
        } finally {
            gate?.setPauseHandler(null)
            conn.disconnect()
        }
    }
}
