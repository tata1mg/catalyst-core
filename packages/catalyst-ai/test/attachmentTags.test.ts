import { describe, expect, it } from "vitest"
import { convertAttachmentTags } from "../src/attachmentTags.js"

const sentinels = (text: string) => [...text.matchAll(/\x00SATTACH:(.*?)\x00/g)].map((m) => JSON.parse(m[1]))

describe("convertAttachmentTags", () => {
    it("converts the long form and the short form", () => {
        const out = convertAttachmentTags("a <tool:create_attachment component='Card' title='T'>body</tool:create_attachment> b <tool:Badge tone='x'>y</tool:Badge>", ["Card", "Badge"])
        expect(sentinels(out)).toEqual([{ component: "Card", attrs: { title: "T" }, body: "body" }, { component: "Badge", attrs: { tone: "x" }, body: "y" }])
        expect(out.startsWith("a ")).toBe(true)
    })

    it("does not rewrite a short tag inside the body of a long-form tag (the Card's payload stays parseable)", () => {
        const out = convertAttachmentTags("<tool:create_attachment component='Card'>hi <tool:Badge>x</tool:Badge></tool:create_attachment>", ["Card", "Badge"])
        const found = sentinels(out)
        expect(found).toHaveLength(1)
        expect(found[0].body).toBe("hi <tool:Badge>x</tool:Badge>")
    })

    it("keeps a > inside a quoted attribute value", () => {
        const short = sentinels(convertAttachmentTags('<tool:Card title="A > B">hello</tool:Card>', ["Card"]))
        expect(short).toEqual([{ component: "Card", attrs: { title: "A > B" }, body: "hello" }])
        const long = sentinels(convertAttachmentTags("<tool:create_attachment component='Card' title='x > y'>hello</tool:create_attachment>", []))
        expect(long).toEqual([{ component: "Card", attrs: { title: "x > y" }, body: "hello" }])
    })

    it("leaves incomplete, unknown and unterminated tags as text", () => {
        for (const text of ["<tool:Card>still streaming", "<tool:Other>x</tool:Other>", "<tool:Card title='open", "plain"]) {
            expect(convertAttachmentTags(text, ["Card"])).toBe(text)
        }
    })

    it("matches component names case-insensitively", () => {
        expect(sentinels(convertAttachmentTags("<tool:card>x</tool:CARD>", ["Card"]))).toEqual([{ component: "Card", attrs: {}, body: "x" }])
    })
})
