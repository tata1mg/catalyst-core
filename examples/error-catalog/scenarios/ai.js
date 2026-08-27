import fs from "fs"
import path from "path"

const BASELINE_CONFIG = {
    NODE_SERVER_HOSTNAME: "localhost",
    NODE_SERVER_PORT: 3005,
    WEBPACK_DEV_SERVER_HOSTNAME: "localhost",
    WEBPACK_DEV_SERVER_PORT: 3006,
    BUILD_OUTPUT_PATH: "build",
    PUBLIC_STATIC_ASSET_PATH: "/assets/",
    PUBLIC_STATIC_ASSET_URL: "http://localhost:3005",
    API_URL: "http://localhost:3005",
    ANALYZE_BUNDLE: false,
    CLIENT_ENV_VARIABLES: ["API_URL"],
    AI_CONFIG: {
        enabled: true,
        basePath: "/ai",
        providers: {
            openai: {
                apiKey: "sk-dummy-key",
                defaultModel: "gpt-4o-mini",
            },
        },
    },
    WEBVIEW_CONFIG: {
        port: 3005,
    },
}

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
            writeJson(path.join(appDir, "config", "config.json"), BASELINE_CONFIG)
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
            writeJson(path.join(appDir, "config", "config.json"), BASELINE_CONFIG)
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
            writeJson(path.join(appDir, "config", "config.json"), BASELINE_CONFIG)
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
            writeJson(path.join(appDir, "config", "config.json"), BASELINE_CONFIG)
        },
        expect: { inOutput: ["AI-000"], status: 500 },
    },
]
