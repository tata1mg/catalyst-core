// <tool:create_attachment component='Name' attr='val'>body</tool:create_attachment> -> the \x00SATTACH:{json}\x00 sentinel
// that the app's renderOutput turns into a component. Only complete tags are converted, so a tag still streaming in stays
// as text until its closing tag arrives.

const ATTACHMENT_TAG_RE = /<tool:create_attachment\s+component='([^']+)'([^>]*)>([\s\S]*?)<\/tool:create_attachment>/g

function toSentinel(_, component, attrStr, body) {
    const attrs = {}
    const attrRe = /(\w+)='([^']*)'/g
    let m
    while ((m = attrRe.exec(attrStr)) !== null) attrs[m[1]] = m[2]
    return `\x00SATTACH:${JSON.stringify({ component, attrs, body: body.trim() })}\x00`
}

export function convertAttachmentTags(text) {
    return text.includes("<tool:create_attachment") ? text.replace(ATTACHMENT_TAG_RE, toSentinel) : text
}
