// The in-browser worker's runaway-repetition guard. The worker is a source string, so the pure function is pulled out of it
// and run here; the whole script is also syntax-checked, because one stray character in that string breaks the engine.
import { WORKER_SCRIPT } from "../src/webWorkerScript.js"

const source = /function isLooping\(text\) \{[\s\S]*?\n\}\n/.exec(WORKER_SCRIPT)?.[0] as string
const isLooping: (text: string) => boolean = new Function(`${source}; return isLooping;`)()

describe("worker script", () => {
    it("is valid JavaScript and contains the loop guard and the repetition penalty", () => {
        expect(source).toBeTruthy()
        expect(() => new Function(`return async () => { ${WORKER_SCRIPT} }`)).not.toThrow()
        expect(WORKER_SCRIPT).toContain("InterruptableStoppingCriteria")
        expect(WORKER_SCRIPT).toContain("repetition_penalty: repetitionPenalty")
    })
})

describe("isLooping", () => {
    it("catches the real runaway: a list item repeated again and again", () => {
        const text = '{"visibleText":["Tata 1mg",' + '"QR inside", '.repeat(8)
        expect(isLooping(text)).toBe(true)
    })
    it("catches short units and long ones", () => {
        expect(isLooping("abc " + "0, ".repeat(14))).toBe(true)
        expect(isLooping("start " + "the same line of text again. ".repeat(7))).toBe(true)
    })
    it("leaves normal output alone, including JSON with repeated structure and a few repeats", () => {
        const rows = [["GLUCOSE", 112], ["CHOLESTEROL", 186], ["HDL", 41], ["TRIGLYCERIDES", 168], ["CREATININE", 0.9]]
            .map(([n, v]) => `{"name":"${n}","value":${v},"unit":"mg/dL","flag":"normal"}`).join(",")
        expect(isLooping(`{"isLabReport":true,"results":[${rows}]}`)).toBe(false)
        expect(isLooping('"QR inside", "QR inside", "QR inside"')).toBe(false) // three is not a loop
        expect(isLooping("")).toBe(false)
        expect(isLooping("    ".repeat(40))).toBe(false) // whitespace alone is not a loop
    })
    it("only looks at the end, so it can fire as soon as the loop is established", () => {
        let text = ""
        let firedAt = -1
        for (let i = 0; i < 40 && firedAt < 0; i++) {
            text += '"QR inside", '
            if (isLooping(text)) firedAt = i + 1
        }
        expect(firedAt).toBeGreaterThan(0)
        expect(firedAt).toBeLessThanOrEqual(12)
    })
})
