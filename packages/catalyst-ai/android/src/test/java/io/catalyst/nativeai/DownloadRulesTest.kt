package io.catalyst.nativeai

import java.io.File
import java.nio.file.Files
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The pure rules of the model download: what a 206 must say, how the pause/resume gate behaves, and which old files may be removed. */
class DownloadRulesTest {

    // ---- 206 responses ------------------------------------------------------------------------------------------------------------

    private fun outcome(range: String?, length: Long?, offset: Long = 100) =
        ResumeRules.interpret(status = 206, offset = offset, contentRange = range, contentLength = length)

    @Test
    fun `a 206 that starts where we asked, runs to the last byte and has the matching body length is appended`() {
        assertEquals(ResumeRules.Outcome.Append(500), outcome("bytes 100-499/500", 400))
        assertEquals(ResumeRules.Outcome.Append(500), outcome("bytes 100-499/500", null)) // no length announced: the range itself is enough
    }

    @Test
    fun `a 206 whose end is not the last byte is not accepted, even if the start and total look right`() {
        assertEquals(ResumeRules.Outcome.Restart, outcome("bytes 100-299/500", 200))
    }

    @Test
    fun `a 206 whose body length disagrees with its own range is not accepted`() {
        assertEquals(ResumeRules.Outcome.Restart, outcome("bytes 100-499/500", 399))
        assertEquals(ResumeRules.Outcome.Restart, outcome("bytes 100-499/500", 401))
    }

    @Test
    fun `a 206 at the wrong offset, without a total, or without a range at all restarts`() {
        assertEquals(ResumeRules.Outcome.Restart, outcome("bytes 50-499/500", 450))
        assertEquals(ResumeRules.Outcome.Restart, outcome("bytes 100-499/*", 400))
        assertEquals(ResumeRules.Outcome.Restart, outcome(null, 400))
    }

    // ---- the pause / resume gate --------------------------------------------------------------------------------------------------

    @Test
    fun `a resume that lands after the caller looked but before it napped ends the nap at once`() {
        val gate = DownloadGate()
        val mark = gate.ticket()
        gate.resume() // the page says the network is back, a moment before the backoff nap starts
        val started = System.nanoTime()
        assertTrue(gate.nap(30.0, since = mark))
        assertTrue("it must not serve the 30 s", (System.nanoTime() - started) / 1_000_000 < 2_000)
    }

    @Test
    fun `without a mark a nap still waits for a resume that comes later`() {
        val gate = DownloadGate()
        thread { Thread.sleep(150); gate.resume() }
        assertTrue(gate.nap(10.0))
    }

    @Test
    fun `a nap with nothing resuming it times out`() {
        assertFalse(DownloadGate().nap(0.1))
    }

    @Test
    fun `waiting while paused returns at once when the pause is already lifted, and otherwise waits for the resume`() {
        val gate = DownloadGate()
        assertTrue(gate.napWhilePaused(30.0)) // not paused: nothing to wait for
        gate.pause(PauseReason.OFFLINE)
        thread { Thread.sleep(150); gate.resume() }
        assertTrue(gate.napWhilePaused(10.0))
        gate.pause(PauseReason.OFFLINE)
        assertFalse(gate.napWhilePaused(0.1)) // paused and nobody resumes: the wait times out
    }

    // ---- files of earlier versions ------------------------------------------------------------------------------------------------

    @Test
    fun `old copies of a model and their temporary files are removed, and nothing else`() {
        val dir = Files.createTempDirectory("models").toFile()
        try {
            val old = File(dir, "Qwen3-0.6B-it-int4.litertlm").apply { writeText("old") }
            val oldTmp = File(dir, "Qwen3-0.6B-it-int4.litertlm.tmp").apply { writeText("partial") }
            val current = File(dir, "Qwen3-0.6B.litertlm").apply { writeText("current") }
            val other = File(dir, "gemma-4-E2B-it.litertlm").apply { writeText("gemma") }
            val removed = LegacyModelFiles.remove(dir, listOf("Qwen3-0.6B-it-int4.litertlm", "never-existed.litertlm"))
            assertEquals(listOf("Qwen3-0.6B-it-int4.litertlm", "Qwen3-0.6B-it-int4.litertlm.tmp"), removed)
            assertFalse(old.exists())
            assertFalse(oldTmp.exists())
            assertTrue(current.exists())
            assertTrue(other.exists())
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun `a legacy name that is a path is never followed out of the models directory`() {
        val parent = Files.createTempDirectory("parent").toFile()
        try {
            val dir = File(parent, "ai_models").apply { mkdirs() }
            val outside = File(parent, "keep.txt").apply { writeText("keep") }
            assertTrue(LegacyModelFiles.remove(dir, listOf("../keep.txt")).isEmpty())
            assertTrue(outside.exists())
        } finally {
            parent.deleteRecursively()
        }
    }
}
