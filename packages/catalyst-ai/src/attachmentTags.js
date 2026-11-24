// <tool:create_attachment component='Name' attr='val'>body</tool:create_attachment> -> the \x00SATTACH:{json}\x00 sentinel
// that the app's renderOutput turns into a component. Only complete tags are converted, so a tag still streaming in stays
// as text until its closing tag arrives.
// Small models drift from the long form, so with the registered component names the short form <tool:Name ...>body</tool:Name>
// is converted too (names match case-insensitively), and attribute values may be quoted with ' or ".

const ATTACHMENT_TAG_RE = /<tool:create_attachment\s+component=(?:'([^']+)'|"([^"]+)")([^>]*)>([\s\S]*?)<\/tool:create_attachment>/g

function parseAttrs(attrStr) {
    const attrs = {}
    const attrRe = /(\w+)=(?:'([^']*)'|"([^"]*)")/g
    let m
    while ((m = attrRe.exec(attrStr)) !== null) attrs[m[1]] = m[2] ?? m[3]
    return attrs
}

const sentinel = (component, attrStr, body) => `\x00SATTACH:${JSON.stringify({ component, attrs: parseAttrs(attrStr), body: body.trim() })}\x00`

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function convertAttachmentTags(text, componentNames = []) {
    if (!text.includes("<tool:")) return text
    let out = text.replace(ATTACHMENT_TAG_RE, (_, a, b, attrStr, body) => sentinel(a ?? b, attrStr, body))
    if (componentNames.length) {
        const byLower = new Map(componentNames.map((n) => [n.toLowerCase(), n]))
        const shortRe = new RegExp(`<tool:(${componentNames.map(escapeRe).join("|")})(\\s[^>]*)?>([\\s\\S]*?)<\\/tool:\\1>`, "gi")
        out = out.replace(shortRe, (_, name, attrStr = "", body) => sentinel(byLower.get(name.toLowerCase()), attrStr, body))
    }
    return out
}
