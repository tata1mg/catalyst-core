package io.yourname.androidproject

import io.yourname.androidproject.utils.GeolocationPrompts
import io.yourname.androidproject.utils.GeolocationPrompts.Outcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the WebView does with a `navigator.geolocation` prompt: allow at once, deny at once, or wait for the runtime permission
 * dialog. A page must always get an answer, otherwise its geolocation call hangs.
 */
class GeolocationPromptsTest {

    private data class Answer(val callback: String, val origin: String?, val allow: Boolean)

    private val answers = mutableListOf<Answer>()
    private val prompts = GeolocationPrompts<String> { callback, origin, allow -> answers += Answer(callback, origin, allow) }

    private val origin = "https://app.example"

    @Test
    fun `allows at once when the app already holds a location permission`() {
        val outcome = prompts.onPrompt(origin, "page-1", hasPermission = true, canAsk = true)
        assertEquals(Outcome.GRANTED, outcome)
        assertEquals(listOf(Answer("page-1", origin, true)), answers)
        assertFalse(prompts.hasPending)
    }

    @Test
    fun `an allowed prompt without a callback does not crash`() {
        assertEquals(Outcome.GRANTED, prompts.onPrompt(origin, null, hasPermission = true, canAsk = true))
        assertTrue(answers.isEmpty())
    }

    @Test
    fun `denies at once when nothing can ask the user, so the page does not hang`() {
        assertEquals(Outcome.DENIED, prompts.onPrompt(origin, "page-1", hasPermission = false, canAsk = false))
        assertEquals(listOf(Answer("page-1", origin, false)), answers)
        assertFalse(prompts.hasPending)
    }

    @Test
    fun `denies a prompt that has no origin, and one that has no callback`() {
        assertEquals(Outcome.DENIED, prompts.onPrompt(null, "page-1", hasPermission = false, canAsk = true))
        assertEquals(listOf(Answer("page-1", null, false)), answers)
        answers.clear()
        assertEquals(Outcome.DENIED, prompts.onPrompt(origin, null, hasPermission = false, canAsk = true))
        assertTrue("there is nobody to answer", answers.isEmpty())
        assertFalse(prompts.hasPending)
    }

    @Test
    fun `waits for the runtime permission, then allows when it is granted`() {
        assertEquals(Outcome.WAITING_FOR_PERMISSION, prompts.onPrompt(origin, "page-1", hasPermission = false, canAsk = true))
        assertTrue(prompts.hasPending)
        assertTrue("nothing is answered while the dialog is open", answers.isEmpty())
        prompts.onPermissionResult(granted = true)
        assertEquals(listOf(Answer("page-1", origin, true)), answers)
        assertFalse(prompts.hasPending)
    }

    @Test
    fun `waits for the runtime permission, then denies when it is refused`() {
        prompts.onPrompt(origin, "page-1", hasPermission = false, canAsk = true)
        prompts.onPermissionResult(granted = false)
        assertEquals(listOf(Answer("page-1", origin, false)), answers)
    }

    @Test
    fun `a newer prompt denies the one still waiting, and only the newest gets the result`() {
        prompts.onPrompt("https://old.example", "old-page", hasPermission = false, canAsk = true)
        prompts.onPrompt("https://new.example", "new-page", hasPermission = false, canAsk = true)
        assertEquals("the older page is denied rather than left hanging", listOf(Answer("old-page", "https://old.example", false)), answers)
        prompts.onPermissionResult(granted = true)
        assertEquals(Answer("new-page", "https://new.example", true), answers.last())
        assertEquals(2, answers.size)
    }

    @Test
    fun `a permission result with nothing waiting is harmless, and a result answers only once`() {
        prompts.onPermissionResult(granted = true)
        assertTrue(answers.isEmpty())
        prompts.onPrompt(origin, "page-1", hasPermission = false, canAsk = true)
        prompts.onPermissionResult(granted = true)
        prompts.onPermissionResult(granted = true)
        assertEquals(1, answers.size)
    }
}
