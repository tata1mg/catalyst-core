import fs from "fs"
import path from "path"
import { BASELINE_CONFIG, restoreBaselineConfig } from "./_baseline.js"

// BASELINE_CONFIG is the parsed committed config — see _baseline.js. break()
// paths deep-clone it into a broken variant; restore() writes the committed
// bytes back via restoreBaselineConfig().

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4))
}

export const aiScenarios = [
    {
        code: "AI-001",
        title: "GET /ai/providers with AI_CONFIG.enabled false -> 403",
        tier: "AI",
        break: (appDir) => {
            const cfg = JSON.parse(JSON.stringify(BASELINE_CONFIG))
            cfg.AI_CONFIG = { basePath: "/ai" }
            writeJson(path.join(appDir, "config", "config.json"), cfg)
        },
        run: { cmd: "catalyst", args: ["start"], kind: "http", method: "GET", path: "/ai/providers" },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["AI-001", "/errors/AI/AI-001.md"], status: 403 },
    },
    {
        code: "AI-002",
        title: "POST /ai/openai/generate, provider has no apiKey -> 404",
        tier: "AI",
        break: (appDir) => {
            const cfg = JSON.parse(JSON.stringify(BASELINE_CONFIG))
            cfg.AI_CONFIG.enabled = true
            cfg.AI_CONFIG.providers.openai = { defaultModel: "gpt-4o-mini" }
            writeJson(path.join(appDir, "config", "config.json"), cfg)
        },
        run: {
            cmd: "catalyst",
            args: ["start"],
            kind: "http",
            method: "POST",
            path: "/ai/openai/generate",
            body: { messages: [{ role: "user", content: "hi" }] },
        },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["AI-002", "/errors/AI/AI-002.md"], status: 404 },
    },
    {
        code: "AI-003",
        title: "POST /ai/openai/generate body {messages:[]} -> 400",
        tier: "AI",
        break: (appDir) => {
            const cfg = JSON.parse(JSON.stringify(BASELINE_CONFIG))
            cfg.AI_CONFIG.enabled = true
            cfg.AI_CONFIG.providers.openai = { apiKey: "sk-dummy-key", defaultModel: "gpt-4o-mini" }
            writeJson(path.join(appDir, "config", "config.json"), cfg)
        },
        run: {
            cmd: "catalyst",
            args: ["start"],
            kind: "http",
            method: "POST",
            path: "/ai/openai/generate",
            body: { messages: [] },
        },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["AI-003", "/errors/AI/AI-003.md"], status: 400 },
    },
    {
        code: "AI-000",
        title: "valid request, provider returns a non-2xx upstream -> 500, code AI-000",
        tier: "AI",
        // route.js's provider endpoints are hardcoded literals (no baseURL
        // override — that's a deliberate security property, see the semgrep
        // note in catalyst-ai/src/route.js), so the only way to make the
        // upstream fail is a real request with a bad key. That means a live
        // call to api.openai.com — fine for the interactive demo, but skipped
        // in CI (no reliable outbound network / rate limits). See
        // `network: true` handling in test/scenarios.test.ts and demo.js.
        network: true,
        break: (appDir) => {
            const cfg = JSON.parse(JSON.stringify(BASELINE_CONFIG))
            cfg.AI_CONFIG.enabled = true
            cfg.AI_CONFIG.providers.openai = { apiKey: "sk-invalid-fake-key", defaultModel: "gpt-4o-mini" }
            writeJson(path.join(appDir, "config", "config.json"), cfg)
        },
        run: {
            cmd: "catalyst",
            args: ["start"],
            kind: "http",
            method: "POST",
            path: "/ai/openai/generate",
            body: { messages: [{ role: "user", content: "hello" }] },
        },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["AI-000"], status: 500 },
    },

    // ── AI-003 regressions ────────────────────────────────────────────────────
    // Each of these is a mistake in the REQUEST that used to slip through (to a provider, or to a 500 from inside an
    // adapter). They all have to come back as 400 with the registry code and its docs link, and none of them may make a
    // provider call, so they need no network. Keeping them here means the error-catalog CI job fails if one regresses.
    aiRequestScenario({
        title: "message content that is an object, not a string or parts array -> 400 (it used to skip media validation)",
        provider: "openai",
        path: "/ai/openai/generate",
        body: { messages: [{ role: "user", content: { type: "image", data: "data:image/png;base64,AAAA" } }] },
    }),
    aiRequestScenario({
        title: "Gemini image with n > 1 -> 400, not a 500 from inside the adapter",
        provider: "gemini",
        path: "/ai/gemini/image",
        body: { prompt: "a cat", n: 2 },
    }),
    aiRequestScenario({
        title: "Gemini image with a size -> 400, not default dimensions returned as if it were honoured",
        provider: "gemini",
        path: "/ai/gemini/image",
        body: { prompt: "a cat", size: "1024x1024" },
    }),
    aiRequestScenario({
        title: "Gemini speech with format mp3 -> 400, not a 500 from inside the adapter",
        provider: "gemini",
        path: "/ai/gemini/speech",
        body: { text: "hello", format: "mp3" },
    }),
    aiRequestScenario({
        title: "image edit with base64 that cannot decode -> 400 before any provider call",
        provider: "openai",
        path: "/ai/openai/image",
        body: { prompt: "edit this", images: [{ mimeType: "image/png", data: "A" }] },
    }),
    aiRequestScenario({
        title: "maxTokens of 0 -> 400, not read as unset and silently turned into a large default",
        provider: "openai",
        path: "/ai/openai/generate",
        body: { messages: [{ role: "user", content: "hi" }], genConfig: { maxTokens: 0 } },
    }),
]

/**
 * One AI-003 scenario: a configured provider (a dummy key, never used) and a request the route must refuse with a 400
 * before it reaches any provider.
 */
function aiRequestScenario({ title, provider, path: urlPath, body }) {
    return {
        code: "AI-003",
        title,
        tier: "AI",
        break: (appDir) => {
            const cfg = JSON.parse(JSON.stringify(BASELINE_CONFIG))
            cfg.AI_CONFIG.enabled = true
            cfg.AI_CONFIG.providers[provider] = {
                apiKey: "dummy-key-never-used",
                defaultModel: provider === "gemini" ? "gemini-3.5-flash" : "gpt-4o-mini",
                imageModel: provider === "gemini" ? "gemini-2.5-flash-image" : "gpt-image-1",
                speechModel: provider === "gemini" ? "gemini-2.5-flash-preview-tts" : "tts-1",
            }
            writeJson(path.join(appDir, "config", "config.json"), cfg)
        },
        run: { cmd: "catalyst", args: ["start"], kind: "http", method: "POST", path: urlPath, body },
        restore: (appDir) => {
            restoreBaselineConfig(appDir)
        },
        expect: { inOutput: ["AI-003", "/errors/AI/AI-003.md"], status: 400 },
    }
}
