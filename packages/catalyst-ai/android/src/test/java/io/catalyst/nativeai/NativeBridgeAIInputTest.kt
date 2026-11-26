package io.catalyst.nativeai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** genConfig.inputParts must never turn a malformed media request into a quiet text-only one, and a download must be checked. */
class NativeBridgeAIInputTest {
    private fun parts(json: String) = readInputParts(JSONObject(json))

    @Test
    fun absentNullAndEmptyAreTextOnly() {
        assertNull(parts("{}"))
        assertNull(parts("""{"inputParts":null}"""))
        assertNull(parts("""{"inputParts":[]}"""))
    }

    @Test
    fun anArrayOfPartsIsReturned() {
        val got = parts("""{"inputParts":[{"type":"image","mimeType":"image/png","base64":"AAAA"}]}""")
        assertNotNull(got)
        assertEquals(1, got!!.length())
    }

    @Test
    fun anyOtherShapeIsAnErrorNotTextOnly() {
        for (bad in listOf(""""inputParts":"oops"""", """"inputParts":5""", """"inputParts":{"type":"image"}""", """"inputParts":true""")) {
            val error = assertThrows(IllegalArgumentException::class.java) { parts("{$bad}") }
            assertTrue(error.message, error.message!!.contains("inputParts must be an array"))
        }
    }

    @Test
    fun aCompleteDownloadHasNoProblem() {
        assertNull(DownloadSizeCheck.problem(size = 1000, announcedTotal = 1000, expectedSize = 5000))
    }

    @Test
    fun withoutAnAnnouncedTotalTheRegistrySizeStandsIn() {
        assertNull(DownloadSizeCheck.problem(size = 5000, announcedTotal = -1, expectedSize = 5000))
        val short = DownloadSizeCheck.problem(size = 3000, announcedTotal = -1, expectedSize = 5000)
        assertNotNull(short)
        assertTrue(short!!.transient)
        assertFalse(short.discardPartial) // short: keep it and resume
    }

    @Test
    fun aLongFileIsDiscarded() {
        val long = DownloadSizeCheck.problem(size = 6000, announcedTotal = 5000, expectedSize = 0)
        assertNotNull(long)
        assertTrue(long!!.discardPartial)
        assertFalse(long.transient)
    }

    @Test
    fun aFileThatCannotBeCheckedIsNotAccepted() {
        val unknown = DownloadSizeCheck.problem(size = 4321, announcedTotal = -1, expectedSize = 0)
        assertNotNull(unknown)
        assertTrue(unknown!!.discardPartial)
    }
}
