// <tool:create_attachment component='Name' attr='val'>body</tool:create_attachment> -> the \x00SATTACH:{json}\x00 sentinel
// that the app's renderOutput turns into a component. Only complete tags are converted, so a tag still streaming in stays
// as text until its closing tag arrives.
// Small models drift from the long form, so with the registered component names the short form <tool:Name ...>body</tool:Name>
// is converted too (names match case-insensitively), and attribute values may be quoted with ' or ".

function parseAttrs(attrStr) {
    const attrs = {}
    const attrRe = /(\w+)=(?:'([^']*)'|"([^"]*)")/g
    let m
    while ((m = attrRe.exec(attrStr)) !== null) attrs[m[1]] = m[2] ?? m[3]
    return attrs
}


export function convertAttachmentTags(text, componentNames = []) {
    if (!text.includes("<tool:")) return text
    const byLower = new Map(componentNames.map((n) => [n.toLowerCase(), n]))
    // One pass over the ORIGINAL text, both forms together: converting the long form first and then scanning its output for the short
    // form would find "<tool:Badge>" inside a Card's body and put raw sentinel markers into the Card's JSON.
    let out = ""
    let i = 0
    while (i < text.length) {
        const start = text.indexOf("<tool:", i)
        if (start === -1) {
            out += text.slice(i)
            break
        }
        out += text.slice(i, start)
        const converted = convertAt(text, start, byLower)
        if (converted) {
            out += converted.replacement
            i = converted.end
        } else {
            out += "<tool:" // not a complete, known tag: it stays text (it may still be streaming in)
            i = start + "<tool:".length
        }
    }
    return out
}

/** The end of the opening tag that starts at `from` (just after the tag name): the first `>` that is not inside a quoted value. */
function openerEnd(text, from) {
    let quote = null
    for (let k = from; k < text.length; k++) {
        const c = text[k]
        if (quote) {
            if (c === quote) quote = null
        } else if (c === "'" || c === '"') {
            quote = c
        } else if (c === ">") {
            return k
        }
    }
    return -1
}

function convertAt(text, start, byLower) {
    const nameMatch = /^[A-Za-z_][\w-]*/.exec(text.slice(start + "<tool:".length, start + "<tool:".length + 64))
    if (!nameMatch) return null
    const name = nameMatch[0]
    const attrsFrom = start + "<tool:".length + name.length
    const closeAt = openerEnd(text, attrsFrom)
    if (closeAt === -1) return null
    const attrStr = text.slice(attrsFrom, closeAt)
    let component
    const attrs = parseAttrs(attrStr)
    if (name.toLowerCase() === "create_attachment") {
        component = attrs.component
        if (!component) return null
        delete attrs.component
    } else {
        component = byLower.get(name.toLowerCase())
        if (!component) return null
    }
    const closing = `</tool:${name}>`
    const bodyStart = closeAt + 1
    const bodyEnd = text.toLowerCase().indexOf(closing.toLowerCase(), bodyStart)
    if (bodyEnd === -1) return null
    const body = text.slice(bodyStart, bodyEnd)
    return { replacement: `\x00SATTACH:${JSON.stringify({ component, attrs, body: body.trim() })}\x00`, end: bodyEnd + closing.length }
}
