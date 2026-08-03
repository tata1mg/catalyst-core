export function buildAttachmentSystemPrompt(systemPrompt, attachmentComponents) {
    const componentNames = Object.keys(attachmentComponents)
    if (componentNames.length === 0 && !systemPrompt) return null
    const parts = []
    if (systemPrompt) parts.push(systemPrompt)
    if (componentNames.length > 0) {
        parts.push(
            "Never use markdown headers, bullet points, numbered lists, or bold. Instead use these components: <tool:create_attachment component='Name' [attr='val']>content</tool:create_attachment>"
        )
        const summary = componentNames
            .map((name) => {
                const hint = attachmentComponents[name]?.hint
                return hint ? `${name} (${hint})` : name
            })
            .join(", ")
        parts.push(`Available components: ${summary}`)
    }
    return parts.join("\n")
}
