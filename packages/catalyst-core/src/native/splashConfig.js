"use strict"

const fs = require("fs")
const path = require("path")

// Plain CJS with no ESM-syntax imports, so buildIos/config.js can require it and
// still load with require in tests (see test/native/nativeConfig.test.ts).

// Only #rrggbb: the one form Android's Color.parseColor, the iOS hex parser and CSS all read the same way.
const SPLASH_COLOR = /^#[0-9a-f]{6}$/i

/**
 * Hand the resolved splash settings to public/splashscreen.html as
 * window.__CATALYST_SPLASH__, in a script placed before the page's own. Neither
 * native shell passes anything to the splash WebView, and the page must paint
 * the same colour as the native layer under it. Returns the html unchanged
 * when the colour is not one we can vouch for; never throws.
 */
function injectSplashConfig(html, { backgroundColor } = {}) {
    try {
        if (typeof html !== "string" || typeof backgroundColor !== "string") return html
        const color = backgroundColor.trim()
        if (!SPLASH_COLOR.test(color)) return html

        const json = JSON.stringify({ backgroundColor: color }).replace(/</g, "\\u003c")
        const script = `<script>window.__CATALYST_SPLASH__=${json}</script>`

        // First match only; a function replacer, so `$` sequences are never read as patterns.
        for (const pattern of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /^\uFEFF?\s*<!doctype\b[^>]*>/i]) {
            if (pattern.test(html)) return html.replace(pattern, (tag) => tag + script)
        }
        return script + html
    } catch {
        return html
    }
}

/**
 * Copy the app's splash page into the native project with the colour injected.
 * A missing source removes a stale copy, so deleting the file turns the HTML
 * splash off. Returns whether a page was written; file errors are the caller's.
 */
function copySplashHtml(sourcePath, destPath, backgroundColor) {
    if (!fs.existsSync(sourcePath)) {
        fs.rmSync(destPath, { force: true })
        return false
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.writeFileSync(destPath, injectSplashConfig(fs.readFileSync(sourcePath, "utf8"), { backgroundColor }))
    return true
}

module.exports = { injectSplashConfig, copySplashHtml }
