package io.catalyst.nativeai

import org.json.JSONObject
import java.io.IOException
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

// iOS equivalent: Support/DownloadControl.swift and Support/ResilientDownload.swift. Keep the two in step.
//
// What a model download needs to survive a bad connection: the policy (how slow is "weak", how long to wait), a gate
// the page pauses and resumes (it learns about connectivity from useNetworkStatus), a throughput window that spots a
// weak link, and a retry loop around the resumable downloader. No Android dependencies, so it can be tested on a JVM.

internal enum class PauseReason(val wire: String) {
    /** The page reported the device offline. */
    OFFLINE("offline"),
    /** The transfer fell below the minimum speed for a sustained window. */
    WEAK("weak"),
    /** A transient failure (reset connection, timeout, 5xx); retrying with backoff. */
    ERROR("error");

    companion object {
        fun from(value: String?): PauseReason? = values().firstOrNull { it.wire == value }
    }
}

/** Tunable from config.json (`AI_CONFIG.browser.download`); out-of-range values are clamped, never rejected. */
internal class DownloadPolicy(
    /** Below this many bytes per second, sustained for [windowSec], the link counts as weak. */
    var minBytesPerSec: Double = 50_000.0,
    var windowSec: Double = 20.0,
    /** First wait before retrying after a weak link or an error; doubles each time without progress, capped. */
    var resumeDelaySec: Double = 10.0,
    var maxDelaySec: Double = 120.0,
    /** Attempts in a row that moved no bytes before the download gives up (the partial stays on disk). */
    var maxIdleRetries: Int = 8,
    /** While the page says "offline", try again on this interval anyway, in case it never hears the network return. */
    var heldRetrySec: Double = 120.0,
) {
    companion object {
        fun from(obj: JSONObject?): DownloadPolicy {
            val p = DownloadPolicy()
            if (obj == null) return p
            fun number(key: String): Double? = if (obj.has(key) && obj.opt(key) is Number) obj.getDouble(key) else null
            number("minBytesPerSec")?.let { p.minBytesPerSec = min(max(it, 0.0), 50_000_000.0) }
            number("windowSec")?.let { p.windowSec = min(max(it, 5.0), 300.0) }
            number("resumeDelaySec")?.let { p.resumeDelaySec = min(max(it, 1.0), 600.0) }
            number("maxIdleRetries")?.let { p.maxIdleRetries = min(max(it, 1.0), 50.0).toInt() }
            p.maxDelaySec = max(p.maxDelaySec, p.resumeDelaySec)
            return p
        }
    }

    /** Wait before retry number [attempt] (1-based): resumeDelaySec, doubling, capped. */
    fun backoff(attempt: Int): Double = min(maxDelaySec, resumeDelaySec * 2.0.pow(max(attempt - 1, 0).toDouble()))
}

/** Shared between the bridge commands (pauseAIDownload / resumeAIDownload) and the download loop. */
internal class DownloadGate {
    companion object {
        val shared = DownloadGate()
    }

    private val lock = Object()
    @Volatile var pausedReason: PauseReason? = null
        private set
    @Volatile private var pauseHandler: ((PauseReason) -> Unit)? = null
    private var resumeTicket = 0L

    /** The transfer in flight registers here so a pause interrupts it instead of waiting for it to finish. */
    fun setPauseHandler(handler: ((PauseReason) -> Unit)?) {
        pauseHandler = handler
    }

    fun pause(reason: PauseReason) {
        pausedReason = reason
        pauseHandler?.invoke(reason)
    }

    /** Clears the pause and wakes everything waiting: a held download, or a backoff nap that can now end early. */
    fun resume() {
        synchronized(lock) {
            pausedReason = null
            resumeTicket++
            lock.notifyAll()
        }
    }

    /** Returns true when woken by [resume], false when [seconds] passed first. */
    fun nap(seconds: Double): Boolean {
        val deadline = System.nanoTime() + (max(seconds, 0.0) * 1e9).toLong()
        synchronized(lock) {
            val ticket = resumeTicket
            while (resumeTicket == ticket) {
                val leftMs = (deadline - System.nanoTime()) / 1_000_000
                if (leftMs <= 0) return false
                lock.wait(leftMs)
            }
            return true
        }
    }
}

/**
 * Spots a weak link: bytes per second over a sliding window. The first chunk starts the clock, so connection setup and
 * redirects are not counted against the link. A transfer that delivers nothing at all is caught by the read timeout
 * instead (no chunks arrive to measure).
 */
internal class ThroughputWindow(private val minBytesPerSec: Double, private val windowSec: Double) {
    sealed class Verdict {
        object Ok : Verdict()
        data class Weak(val bytesPerSec: Double) : Verdict()
    }

    private var windowStartMs: Long? = null
    private var bytes = 0L

    fun record(count: Long, nowMs: Long = System.currentTimeMillis()): Verdict {
        val start = windowStartMs
        if (start == null) {
            windowStartMs = nowMs
            bytes = 0 // the first chunk only starts the clock
            return Verdict.Ok
        }
        bytes += count
        val elapsed = (nowMs - start) / 1000.0
        if (elapsed < windowSec) return Verdict.Ok
        val rate = bytes / elapsed
        windowStartMs = nowMs
        bytes = 0
        return if (rate < minBytesPerSec) Verdict.Weak(rate) else Verdict.Ok
    }
}

/** The transfer was stopped on purpose (the page paused it, or the link was too slow). The partial is kept. */
internal class DownloadInterrupted(val kind: Kind) : Exception("Download interrupted: $kind") {
    sealed class Kind {
        data class Paused(val reason: PauseReason) : Kind()
        data class Weak(val bytesPerSec: Double) : Kind()
    }
}

internal sealed class DownloadStatus {
    /** Waiting to try again. [retryInSec] is null when the wait ends only when the page resumes (or the safety net). */
    data class Paused(val reason: PauseReason, val retryInSec: Int?) : DownloadStatus()
    object Resuming : DownloadStatus()
}

/**
 * Runs a resumable download until it finishes, across the things a phone connection does: the page reports offline,
 * the link goes too slow, the connection resets or times out. Every attempt resumes from the partial, so waiting
 * costs nothing already downloaded.
 */
internal class ResilientDownload(
    private val policy: DownloadPolicy,
    private val gate: DownloadGate,
    private val partialSize: () -> Long,
    private val log: (String) -> Unit = {},
    private val emit: (DownloadStatus) -> Unit,
) {
    companion object {
        fun isTransient(e: Throwable): Boolean = when (e) {
            is DownloadException -> e.transient
            is IOException -> true // connect and read failures; disk errors are rethrown as DownloadException by the downloader
            else -> false
        }
    }

    /** [attempt] performs one resumable download and returns the final size. */
    fun run(attempt: () -> Long): Long {
        var idle = 0        // attempts in a row that moved no bytes
        var weakStreak = 0  // consecutive weak-link interruptions: the wait between them grows
        var lastSize = partialSize()

        while (true) {
            if (Thread.currentThread().isInterrupted) throw InterruptedException()

            gate.pausedReason?.let { reason ->
                emit(DownloadStatus.Paused(reason, null))
                val resumed = gate.nap(policy.heldRetrySec)
                if (!resumed) {
                    // The page never said the network came back (it may have been suspended): try anyway.
                    log("Still paused by the page after ${policy.heldRetrySec.toInt()}s; trying again")
                    gate.resume()
                }
                emit(DownloadStatus.Resuming)
            }

            var reason = PauseReason.ERROR
            try {
                return attempt()
            } catch (e: DownloadInterrupted) {
                when (val kind = e.kind) {
                    is DownloadInterrupted.Kind.Paused -> continue // the top of the loop waits on the gate
                    is DownloadInterrupted.Kind.Weak -> {
                        reason = PauseReason.WEAK
                        weakStreak++
                        log("Weak connection (${(kind.bytesPerSec / 1000).toInt()} KB/s); waiting before trying again")
                    }
                }
            } catch (e: Exception) {
                if (!isTransient(e)) throw e
                weakStreak = 0
                log("Download interrupted (${e.message}); will retry")
            }

            val size = partialSize()
            if (size > lastSize) idle = 0 else idle++
            lastSize = size
            if (idle > policy.maxIdleRetries) {
                throw DownloadException(
                    "Download made no progress after $idle attempts; the partial file is kept for the next try",
                    discardPartial = false,
                )
            }

            val delay = policy.backoff(if (reason == PauseReason.WEAK) weakStreak else max(idle, 1))
            emit(DownloadStatus.Paused(reason, Math.ceil(delay).toInt()))
            gate.nap(delay) // the page's resume command ends this early
            emit(DownloadStatus.Resuming)
        }
    }
}
