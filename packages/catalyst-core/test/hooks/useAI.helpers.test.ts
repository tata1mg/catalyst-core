import { describe, expect, it } from "vitest"
import { modalitiesOf, taskOf } from "../../src/native/bridge/hooks/useAI"

describe("modalitiesOf: what the request really contains", () => {
    it("string content and text parts are text", () => {
        expect(modalitiesOf([{ role: "user", content: "hi" }])).toEqual(["text"])
        expect(modalitiesOf([{ role: "user", content: [{ type: "text", text: "hi" }] }])).toEqual(["text"])
    })
    it("an audio-only or image-only request is not also a text request", () => {
        expect(modalitiesOf([{ role: "user", content: [{ type: "audio", data: "x" }] }])).toEqual(["audio"])
        expect(modalitiesOf([{ role: "user", content: [{ type: "image", data: "x" }] }])).toEqual(["image"])
    })
    it("mixed content lists each modality once", () => {
        const got = modalitiesOf([{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", data: "x" }, { type: "audio", data: "y" }, { type: "image", data: "z" }] }])
        expect([...got].sort()).toEqual(["audio", "image", "text"])
    })
    it("nothing recognisable is plain text", () => {
        expect(modalitiesOf(undefined)).toEqual(["text"])
        expect(modalitiesOf([])).toEqual(["text"])
        expect(modalitiesOf([{ role: "user" }])).toEqual(["text"])
    })
})

describe("taskOf: the call wins, even when it names something unknown", () => {
    it("uses the call's task, then the hook's, then text generation", () => {
        expect(taskOf({ task: "vision.read" }, { task: "embed" })).toBe("vision.read")
        expect(taskOf({}, { task: "embed" })).toBe("embed")
        expect(taskOf(undefined, undefined)).toBe("text.generate")
    })
    it("an unknown task on the call is plain text generation, not the hook's task", () => {
        expect(taskOf({ task: "unknown" }, { task: "embed" })).toBe("text.generate")
        expect(taskOf({ task: undefined }, { task: "embed" })).toBe("text.generate")
        expect(taskOf({ task: 5 }, { task: "image.generate" })).toBe("text.generate")
    })
    it("an unknown task on the hook is plain text generation too", () => {
        expect(taskOf({}, { task: "nope" })).toBe("text.generate")
    })
})
