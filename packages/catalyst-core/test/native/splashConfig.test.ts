import fs from "fs"
import { createRequire } from "module"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const { injectSplashConfig, copySplashHtml } = require("../../src/native/splashConfig.js")

const SCRIPT = '<script>window.__CATALYST_SPLASH__={"backgroundColor":"#0b0a14"}</script>'
const NAVY = { backgroundColor: "#0b0a14" }

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-splash-config-"))
    temps.push(dir)
    return dir
}
afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("injectSplashConfig", () => {
    it("goes right after the <head> opening tag, attributes and all", () => {
        expect(
            injectSplashConfig(
                '<!doctype html><html lang="en"><head data-x="1"><title>S</title></head></html>',
                NAVY
            )
        ).toBe(`<!doctype html><html lang="en"><head data-x="1">${SCRIPT}<title>S</title></head></html>`)
    })

    it("does not mistake <header> for <head>", () => {
        expect(injectSplashConfig("<html><body><header>Hi</header></body></html>", NAVY)).toBe(
            `<html>${SCRIPT}<body><header>Hi</header></body></html>`
        )
        expect(injectSplashConfig("<HTML><HEAD></HEAD><header></header></HTML>", NAVY)).toBe(
            `<HTML><HEAD>${SCRIPT}</HEAD><header></header></HTML>`
        )
    })

    it("falls back to after the doctype, then to the very start", () => {
        expect(injectSplashConfig("<!DOCTYPE html>\n<body>x</body>", NAVY)).toBe(
            `<!DOCTYPE html>${SCRIPT}\n<body>x</body>`
        )
        expect(injectSplashConfig("<body>x</body>", NAVY)).toBe(`${SCRIPT}<body>x</body>`)
        expect(injectSplashConfig("", NAVY)).toBe(SCRIPT)
    })

    it("inserts exactly once, even with several candidate tags", () => {
        const out = injectSplashConfig("<html><head></head><head></head></html>", NAVY)
        expect(out).toBe(`<html><head>${SCRIPT}</head><head></head></html>`)
        expect(out.split("__CATALYST_SPLASH__").length).toBe(2)
    })

    it("accepts #rrggbb in either case, trimmed", () => {
        for (const color of ["#112233", "#ABCDEF", "#0b0A14"]) {
            expect(injectSplashConfig("<head>", { backgroundColor: color })).toBe(
                `<head><script>window.__CATALYST_SPLASH__=${JSON.stringify({ backgroundColor: color })}</script>`
            )
        }
        expect(injectSplashConfig("<head>", { backgroundColor: "  #ABCDEF " })).toContain(
            '{"backgroundColor":"#ABCDEF"}'
        )
    })

    it("injects nothing for forms the native parsers read differently from CSS", () => {
        const html = "<html><head></head></html>"
        for (const backgroundColor of [
            "#fff",
            "#ffff",
            "#11223344",
            "rgb(11, 10, 20)",
            "rgba(0,0,0,0.5)",
            "rgb(0 0 0 / 50%)",
        ]) {
            expect(injectSplashConfig(html, { backgroundColor })).toBe(html)
        }
    })

    it("leaves the page alone for a missing or invalid colour", () => {
        const html = "<html><head></head></html>"
        for (const backgroundColor of [
            undefined,
            null,
            42,
            "",
            "white",
            "#12",
            "#1234567",
            "rgb()",
            "url(x)",
            "#fff;}</style>",
            "#112233;",
        ]) {
            expect(injectSplashConfig(html, { backgroundColor })).toBe(html)
        }
        expect(injectSplashConfig(html)).toBe(html)
        expect(injectSplashConfig(html, {})).toBe(html)
    })

    it("never lets a value close the script", () => {
        const html = "<head>"
        expect(injectSplashConfig(html, { backgroundColor: "</script><script>alert(1)</script>" })).toBe(html)
        expect(injectSplashConfig(html, { backgroundColor: "#112233</script>" })).toBe(html)
    })

    it("keeps $ sequences in the page literal", () => {
        const html = '<head data-a="$&" data-b="$\'"><title>$1 $$</title>'
        expect(injectSplashConfig(html, NAVY)).toBe(
            `<head data-a="$&" data-b="$'">${SCRIPT}<title>$1 $$</title>`
        )
    })

    it("returns non-string input unchanged instead of throwing", () => {
        const buffer = Buffer.from("<head>")
        expect(injectSplashConfig(buffer, NAVY)).toBe(buffer)
        expect(injectSplashConfig(undefined, NAVY)).toBe(undefined)
    })
})

describe("copySplashHtml", () => {
    /** A public/splashscreen.html source and the Android assets destination under a fresh dir. */
    function paths(html?: string) {
        const dir = tempDir()
        const source = path.join(dir, "public", "splashscreen.html")
        const dest = path.join(
            dir,
            "androidProject",
            "app",
            "src",
            "main",
            "assets",
            "splash",
            "splashscreen.html"
        )
        if (html !== undefined) {
            fs.mkdirSync(path.dirname(source), { recursive: true })
            fs.writeFileSync(source, html)
        }
        return { source, dest }
    }

    it("writes the page with the colour injected, creating the assets dir", () => {
        const { source, dest } = paths("<!doctype html><html><head><title>S</title></head></html>")
        expect(copySplashHtml(source, dest, "#0b0a14")).toBe(true)
        expect(fs.readFileSync(dest, "utf8")).toBe(
            `<!doctype html><html><head>${SCRIPT}<title>S</title></head></html>`
        )
    })

    it("replaces an earlier copy", () => {
        const { source, dest } = paths("<head></head>")
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, "old")
        copySplashHtml(source, dest, "#ffffff")
        expect(fs.readFileSync(dest, "utf8")).toBe(
            '<head><script>window.__CATALYST_SPLASH__={"backgroundColor":"#ffffff"}</script></head>'
        )
    })

    it("copies the page untouched for a colour it cannot vouch for", () => {
        const html = "<html><head></head></html>"
        const { source, dest } = paths(html)
        copySplashHtml(source, dest, "purple")
        expect(fs.readFileSync(dest, "utf8")).toBe(html)
    })

    it("removes a stale copy when the source is gone, and tolerates no copy at all", () => {
        const { source, dest } = paths()
        expect(copySplashHtml(source, dest, "#0b0a14")).toBe(false)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, "old")
        expect(copySplashHtml(source, dest, "#0b0a14")).toBe(false)
        expect(fs.existsSync(dest)).toBe(false)
    })
})
