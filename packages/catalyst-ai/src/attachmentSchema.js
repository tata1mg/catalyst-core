// Structured output for small on-device models that cannot follow the <tool:create_attachment> tag syntax. The model is
// forced (Chrome's responseConstraint) to reply { "blocks": [{ "component": <registered name>, "text": "..." }] }, and
// the blocks are turned into the same \x00SATTACH:{json}\x00 sentinels the app's renderOutput already renders.
// An invented component name or an unclosed tag cannot happen: the name is an enum and the JSON is closed by construction.

// The attribute names the components declare ({ level: "1|2|3", title: "string" }), merged into one object schema. "a|b|c" becomes
// an enum; a name two components declare differently falls back to a plain string.
function attrProperties(attachmentComponents) {
    const props = {}
    for (const def of Object.values(attachmentComponents || {})) {
        for (const [name, spec] of Object.entries(def?.attrs || {})) {
            const next = typeof spec === "string" && spec.includes("|") ? { type: "string", enum: spec.split("|").map((v) => v.trim()) } : { type: "string" }
            props[name] = props[name] && JSON.stringify(props[name]) !== JSON.stringify(next) ? { type: "string" } : next
        }
    }
    return props
}

export function buildAttachmentSchema(attachmentComponents) {
    const names = Object.keys(attachmentComponents || {})
    const attrs = attrProperties(attachmentComponents)
    return {
        type: "object",
        properties: {
            blocks: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        component: { type: "string", enum: names },
                        text: { type: "string" },
                        ...(Object.keys(attrs).length && { attrs: { type: "object", properties: attrs, additionalProperties: false } }),
                    },
                    required: ["component", "text"],
                },
            },
        },
        required: ["blocks"],
    }
}

export function buildSchemaSystemPrompt(systemPrompt, attachmentComponents) {
    const summary = Object.entries(attachmentComponents || {})
        .map(([name, def]) => {
            const attrs = Object.entries(def?.attrs || {}).map(([k, v]) => `${k}: ${v}`).join(", ")
            const notes = [def?.hint, attrs && `attrs ${attrs}`].filter(Boolean).join("; ")
            return notes ? `${name} (${notes})` : name
        })
        .join(", ")
    const parts = []
    if (systemPrompt) parts.push(systemPrompt)
    parts.push(
        `Reply with JSON only: {"blocks":[{"component":"Name","text":"content"}]}. Split the answer into blocks and give each block the component that fits it best. Rules: a Header's text is one short title line, never a paragraph. A table is ONE block holding the whole markdown table: the header row, the |---| separator row, then every data row. Never split a table or a list across blocks. Code is plain code in text. Fill in attrs where a component has them. Available components: ${summary}`
    )
    return parts.join("\n")
}

// The complete block objects found so far in a (possibly still streaming) reply. A block still being written is left out
// until its closing brace arrives, so the page never renders half a component.
function completeBlocks(text) {
    const start = text.indexOf("[")
    if (start < 0) return []
    const blocks = []
    let depth = 0
    let inString = false
    let escaped = false
    let objectStart = -1
    for (let i = start + 1; i < text.length; i++) {
        const c = text[i]
        if (inString) {
            if (escaped) escaped = false
            else if (c === "\\") escaped = true
            else if (c === '"') inString = false
            continue
        }
        if (c === '"') inString = true
        else if (c === "{") {
            if (depth === 0) objectStart = i
            depth++
        } else if (c === "}") {
            depth--
            if (depth === 0 && objectStart >= 0) {
                try { blocks.push(JSON.parse(text.slice(objectStart, i + 1))) } catch (_) { /* malformed block: skipped */ }
                objectStart = -1
            }
        } else if (c === "]" && depth === 0) break
    }
    return blocks
}

// Attribute values reach the components as strings, like the ones parsed from a tag.
function cleanAttrs(attrs) {
    if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return {}
    return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))
}

/** The renderable text for a schema-constrained reply: one sentinel per complete block, or null when there is none yet. */
export function blocksToSentinels(text, attachmentComponents) {
    const known = new Set(Object.keys(attachmentComponents || {}))
    const out = completeBlocks(text)
        .filter((b) => b && typeof b.component === "string" && known.has(b.component) && typeof b.text === "string")
        .map((b) => `\x00SATTACH:${JSON.stringify({ component: b.component, attrs: cleanAttrs(b.attrs), body: b.text.trim() })}\x00`)
    return out.length ? out.join("\n") : null
}
