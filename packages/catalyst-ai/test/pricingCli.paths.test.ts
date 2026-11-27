// The pricing CLI's less-travelled paths: help, bad options, a missing or unreadable config, no models, no terminal, and
// answers that are skipped or refused. Each one must end with a clear message and the right exit code, and must never print a key.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
const cli = require("../scripts/pricing-cli.js")

describe("pricing CLI paths", () => {
    let dir: string
    afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

    const write = (config: object | string | null, name = "config/config.json") => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "cai-pricing-paths-"))
        if (config !== null) {
            fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
            fs.writeFileSync(path.join(dir, name), typeof config === "string" ? config : JSON.stringify(config))
        }
        return dir
    }
    const ai = (extra: object = {}) => ({ AI_CONFIG: { enabled: true, providers: { openai: { apiKey: "sk-secret", defaultModel: "gpt-new" } }, ...extra } })
    const harness = (answers: string[] = []) => {
        const out: string[] = [], err: string[] = [], queue = [...answers]
        return { out, err, io: { cwd: dir, out: (s: string) => out.push(s), err: (s: string) => err.push(s), ask: async () => queue.shift() ?? "" } }
    }
    const text = (h: { out: string[]; err: string[] }) => h.out.join("") + h.err.join("")

    it("--help prints the usage and exits 0 without touching any file", async () => {
        write(null)
        const h = harness()
        expect(await cli.run(["--help"], h.io)).toBe(0)
        expect(h.out.join("")).toMatch(/pricing/i)
    })

    it("an unknown option is a usage error (exit 2) that shows the help", async () => {
        write(ai())
        const h = harness()
        expect(await cli.run(["--bogus"], h.io)).toBe(2)
        expect(h.err.join("")).toMatch(/Unknown option "--bogus"/)
    })

    it("a config that does not exist, or is not JSON, is reported with its path", async () => {
        write(null)
        const missing = harness()
        expect(await cli.run([], missing.io)).toBe(2)
        expect(missing.err.join("")).toMatch(/file not found/)
        write("{ not json")
        const broken = harness()
        expect(await cli.run([], broken.io)).toBe(2)
        expect(broken.err.join("")).toMatch(/Could not read/)
    })

    it("--config reads another file, and a config with no AI_CONFIG has nothing to price", async () => {
        write({ NAME: "app" }, "other.json")
        const h = harness()
        expect(await cli.run(["--config", "other.json"], h.io)).toBe(2)
        expect(h.err.join("")).toMatch(/has no AI_CONFIG block/)
    })

    it("an AI_CONFIG with no cloud models says so and exits 0", async () => {
        write({ AI_CONFIG: { enabled: true, providers: {} } })
        const h = harness()
        expect(await cli.run([], h.io)).toBe(0)
        expect(h.out.join("")).toMatch(/No cloud models found/)
    })

    it("without a terminal it refuses to ask and points at --check and --set", async () => {
        write(ai())
        const out: string[] = [], err: string[] = []
        const code = await cli.run([], { cwd: dir, out: (s: string) => out.push(s), err: (s: string) => err.push(s), isTTY: false })
        expect(code).toBe(2)
        expect(err.join("")).toMatch(/No terminal to ask on/)
    })

    it("skipping a model (an empty answer) changes nothing and says so", async () => {
        write(ai())
        const h = harness(["", ""])
        expect(await cli.run([], h.io)).toBe(0)
        expect(text(h)).toMatch(/skipped/)
        expect(text(h)).toMatch(/Nothing changed/)
        expect(JSON.parse(fs.readFileSync(path.join(dir, "config/config.json"), "utf8")).AI_CONFIG.pricing).toBeUndefined()
    })

    it("--set writes the price without asking, and the key is never printed", async () => {
        write(ai())
        const h = harness()
        expect(await cli.run(["--set", "gpt-new=2,10,0.2"], h.io)).toBe(0)
        const saved = JSON.parse(fs.readFileSync(path.join(dir, "config/config.json"), "utf8"))
        expect(saved.AI_CONFIG.pricing["gpt-new"]).toMatchObject({ input: 2, output: 10, cachedInput: 0.2 })
        expect(text(h)).toMatch(/Saved 1 price/)
        expect(text(h)).not.toContain("sk-secret")
    })

    it("a price that does not pass validation is not saved (exit 2) and the file is left as it was", async () => {
        write(ai())
        const before = fs.readFileSync(path.join(dir, "config/config.json"), "utf8")
        const h = harness()
        const code = await cli.run(["--set", "gpt-new=-1,10"], h.io)
        expect([2]).toContain(code)
        expect(fs.readFileSync(path.join(dir, "config/config.json"), "utf8")).toBe(before)
    })

    it("a malformed existing pricing entry is reported and ignored, not fatal", async () => {
        write(ai({ pricing: { "gpt-new": { input: "cheap" } } }))
        const h = harness()
        await cli.run(["--check"], h.io)
        expect(h.err.join("")).toMatch(/Ignoring AI_CONFIG.pricing entry/)
    })
})
