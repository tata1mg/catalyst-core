import { blocksToSentinels, buildAttachmentSchema, buildSchemaSystemPrompt } from "../src/attachmentSchema.js"

const components = { Header: { hint: "title" }, InfoCard: {}, CodeBlock: {} }
const sentinelWith = (c: string, body: string, attrs: Record<string, string>) => `\x00SATTACH:${JSON.stringify({ component: c, attrs, body })}\x00`
const sentinel = (c: string, body: string) => `\x00SATTACH:${JSON.stringify({ component: c, attrs: {}, body })}\x00`

describe("attachment schema", () => {
    it("limits component to the registered names", () => {
        const schema: any = buildAttachmentSchema(components)
        expect(schema.properties.blocks.items.properties.component.enum).toEqual(["Header", "InfoCard", "CodeBlock"])
        expect(schema.properties.blocks.items.required).toEqual(["component", "text"])
    })

    it("adds the declared attributes to the schema, as enums where the spec lists values", () => {
        const withAttrs = { Header: { attrs: { level: "1|2|3" } }, InfoCard: { attrs: { title: "string", type: "info|warning|success" } }, Plain: {} }
        const attrs: any = (buildAttachmentSchema(withAttrs) as any).properties.blocks.items.properties.attrs
        expect(attrs.properties.level.enum).toEqual(["1", "2", "3"])
        expect(attrs.properties.title).toEqual({ type: "string" })
        expect(attrs.properties.type.enum).toEqual(["info", "warning", "success"])
        expect((buildAttachmentSchema(components) as any).properties.blocks.items.properties.attrs).toBeUndefined()
    })

    it("tells the model the JSON shape and the components with their hints", () => {
        const prompt = buildSchemaSystemPrompt("Be brief.", components)
        expect(prompt).toContain("Be brief.")
        expect(prompt).toContain('{"blocks":[{"component":"Name","text":"content"}]}')
        expect(prompt).toContain("Header (title), InfoCard, CodeBlock")
        expect(prompt).toContain("ONE block")
    })
})

describe("blocksToSentinels", () => {
    it("turns each complete block into a sentinel", () => {
        const text = JSON.stringify({ blocks: [{ component: "Header", text: "Hi" }, { component: "InfoCard", text: "2 + 2 = 4" }] })
        expect(blocksToSentinels(text, components)).toBe(`${sentinel("Header", "Hi")}\n${sentinel("InfoCard", "2 + 2 = 4")}`)
    })

    it("leaves a block that is still streaming out until it closes", () => {
        const partial = '{"blocks":[{"component":"Header","text":"Hi"},{"component":"InfoCard","text":"2 +'
        expect(blocksToSentinels(partial, components)).toBe(sentinel("Header", "Hi"))
        expect(blocksToSentinels('{"blocks":[{"component":"Header","te', components)).toBeNull()
    })

    it("is not fooled by braces, brackets and escaped quotes inside the text", () => {
        const text = JSON.stringify({ blocks: [{ component: "CodeBlock", text: 'function f() { return ["a}", "\\"b"] }' }] })
        expect(blocksToSentinels(text, components)).toBe(sentinel("CodeBlock", 'function f() { return ["a}", "\\"b"] }'))
    })

    it("carries the declared attributes as strings and leaves out empty ones", () => {
        const text = JSON.stringify({ blocks: [{ component: "InfoCard", text: "Heads up", attrs: { title: "Note", type: "warning", extra: "", level: null } }] })
        expect(blocksToSentinels(text, components)).toBe(sentinelWith("InfoCard", "Heads up", { title: "Note", type: "warning" }))
    })

    it("drops a block whose component is not registered", () => {
        const text = JSON.stringify({ blocks: [{ component: "PatientLabResults", text: "x" }, { component: "Header", text: "ok" }] })
        expect(blocksToSentinels(text, components)).toBe(sentinel("Header", "ok"))
    })
})
