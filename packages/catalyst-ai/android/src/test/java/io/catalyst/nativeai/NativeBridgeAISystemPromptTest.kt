package io.catalyst.nativeai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Regression coverage for #542 without initializing or downloading a model. */
class NativeBridgeAISystemPromptTest {
    private fun build(options: String): String = buildAISystemPrompt(JSONObject(options))

    @Test
    fun appPromptIsPreservedWithoutComponents() {
        assertEquals("Answer only in French.", build("""{"systemPrompt":"  Answer only in French.  "}"""))
    }

    @Test
    fun appPromptIsPreservedWithEmptyComponents() {
        assertEquals("Return JSON only.", build("""{"systemPrompt":"Return JSON only.","attachmentComponents":{}}"""))
    }

    @Test
    fun missingOrBlankPromptWithoutComponentsProducesNoInstructions() {
        assertEquals("", build("{}"))
        assertEquals("", build("""{"systemPrompt":"  \n\t  "}"""))
        assertEquals("", build("""{"systemPrompt":"  ","attachmentComponents":{}}"""))
    }

    @Test
    fun attachmentInstructionsFollowTheAppPrompt() {
        val prompt = build("""{"systemPrompt":"  Answer in French.  ","attachmentComponents":{"Card":{"hint":"  Show a card  "}}}""")
        assertTrue(prompt.startsWith("Answer in French.\n\nNever use markdown"))
        assertTrue(prompt.contains("<tool:create_attachment component='Name'"))
        assertTrue(prompt.endsWith("Available components: Card (Show a card)"))
    }

    @Test
    fun componentsWithoutAppPromptStillReceiveInstructions() {
        val prompt = build("""{"attachmentComponents":{"Card":{}}}""")
        assertTrue(prompt.startsWith("Never use markdown"))
        assertTrue(prompt.endsWith("Available components: Card"))
        assertFalse(prompt.contains("Card ()"))
    }
}
