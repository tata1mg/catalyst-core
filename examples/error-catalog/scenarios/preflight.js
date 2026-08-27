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

const BASELINE_PKG = {
    name: "error-catalog",
    private: true,
    type: "module",
    scripts: {
        start: "catalyst start",
        serve: "catalyst serve",
        build: "catalyst build",
        demo: "node scripts/demo.js",
        test: "vitest run",
        "sync-core": "node ../sync-core.js",
        "sync-packages": "node ../sync-packages.js --packages ai",
    },
    _moduleAliases: {
        "@api": "server/api.js",
        "@containers": "src/js/containers",
        "@server": "server",
        "@config": "config",
        "@css": "src/static/css",
        "@routes": "src/js/routes/",
    },
    dependencies: {
        "catalyst-core": "*",
        "catalyst-ai": "*",
        react: "19.0.0",
        "react-dom": "19.0.0",
    },
    devDependencies: {
        vitest: "4.1.9",
    },
}

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4))
}

function writeText(filePath, text) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, text)
}

export const preflightScenarios = [
    {
        code: "PREFLIGHT-001",
        title: "config/config.json deleted",
        tier: "halt",
        break: (appDir) => {
            fs.rmSync(path.join(appDir, "config", "config.json"), { force: true })
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeJson(path.join(appDir, "config", "config.json"), BASELINE_CONFIG)
        },
        expect: { inOutput: ["PREFLIGHT-001", "/errors/PREFLIGHT/PREFLIGHT-001.md"], exitNonZero: true },
    },
    {
        code: "PREFLIGHT-002",
        title: "config/config.json is a JSON string",
        tier: "halt",
        break: (appDir) => {
            writeText(path.join(appDir, "config", "config.json"), JSON.stringify("a string"))
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeJson(path.join(appDir, "config", "config.json"), BASELINE_CONFIG)
        },
        expect: { inOutput: ["PREFLIGHT-002", "/errors/PREFLIGHT/PREFLIGHT-002.md"], exitNonZero: true },
    },
    {
        code: "PREFLIGHT-003",
        title: "Removed a required key from config/config.json",
        tier: "halt",
        break: (appDir) => {
            const cfg = { ...BASELINE_CONFIG }
            delete cfg.NODE_SERVER_HOSTNAME
            writeJson(path.join(appDir, "config", "config.json"), cfg)
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeJson(path.join(appDir, "config", "config.json"), BASELINE_CONFIG)
        },
        expect: { inOutput: ["PREFLIGHT-003", "/errors/PREFLIGHT/PREFLIGHT-003.md"], exitNonZero: true },
    },
    {
        code: "PREFLIGHT-004",
        title: "package.json deleted / wrong dir",
        tier: "halt",
        break: (appDir) => {
            fs.rmSync(path.join(appDir, "package.json"), { force: true })
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeJson(path.join(appDir, "package.json"), BASELINE_PKG)
        },
        expect: { inOutput: ["PREFLIGHT-004", "/errors/PREFLIGHT/PREFLIGHT-004.md"], exitNonZero: true },
    },
    {
        code: "PREFLIGHT-005",
        title: "package.json malformed",
        tier: "halt",
        break: (appDir) => {
            writeText(path.join(appDir, "package.json"), "invalid json {")
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeJson(path.join(appDir, "package.json"), BASELINE_PKG)
        },
        expect: { inOutput: ["PREFLIGHT-005", "/errors/PREFLIGHT/PREFLIGHT-005.md"], exitNonZero: true },
    },
    {
        code: "PREFLIGHT-006",
        title: "_moduleAliases removed from package.json",
        tier: "halt",
        break: (appDir) => {
            const pkg = { ...BASELINE_PKG }
            delete pkg._moduleAliases
            writeJson(path.join(appDir, "package.json"), pkg)
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeJson(path.join(appDir, "package.json"), BASELINE_PKG)
        },
        expect: { inOutput: ["PREFLIGHT-006", "/errors/PREFLIGHT/PREFLIGHT-006.md"], exitNonZero: true },
    },
    {
        code: "PREFLIGHT-007",
        title: "_moduleAliases is a string in package.json",
        tier: "halt",
        break: (appDir) => {
            const pkg = { ...BASELINE_PKG, _moduleAliases: "not an object" }
            writeJson(path.join(appDir, "package.json"), pkg)
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeJson(path.join(appDir, "package.json"), BASELINE_PKG)
        },
        expect: { inOutput: ["PREFLIGHT-007", "/errors/PREFLIGHT/PREFLIGHT-007.md"], exitNonZero: true },
    },
    {
        code: "PREFLIGHT-008",
        title: "a _moduleAliases key contains 'catalyst'",
        tier: "halt",
        break: (appDir) => {
            const pkg = {
                ...BASELINE_PKG,
                _moduleAliases: {
                    ...BASELINE_PKG._moduleAliases,
                    "@catalyst-custom": "src/custom",
                },
            }
            writeJson(path.join(appDir, "package.json"), pkg)
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeJson(path.join(appDir, "package.json"), BASELINE_PKG)
        },
        expect: { inOutput: ["PREFLIGHT-008", "/errors/PREFLIGHT/PREFLIGHT-008.md"], exitNonZero: true },
    },
    {
        code: "PREFLIGHT-009",
        title: "_moduleAliases missing @containers",
        tier: "halt",
        break: (appDir) => {
            const aliases = { ...BASELINE_PKG._moduleAliases }
            delete aliases["@containers"]
            const pkg = { ...BASELINE_PKG, _moduleAliases: aliases }
            writeJson(path.join(appDir, "package.json"), pkg)
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeJson(path.join(appDir, "package.json"), BASELINE_PKG)
        },
        expect: { inOutput: ["PREFLIGHT-009", "/errors/PREFLIGHT/PREFLIGHT-009.md"], exitNonZero: true },
    },
    {
        code: "PREFLIGHT-010",
        title: "preServerInit missing from server/index.js",
        tier: "no-call-site",
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["PREFLIGHT-010", "/errors/PREFLIGHT/PREFLIGHT-010.md"] },
    },
    {
        code: "PREFLIGHT-011",
        title: "server/index.js exports preServerInit: 123",
        tier: "warn",
        break: (appDir) => {
            writeText(path.join(appDir, "server", "index.js"), "export const preServerInit = 123\n")
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeText(path.join(appDir, "server", "index.js"), "export const preServerInit = () => {}\n")
        },
        expect: { inOutput: ["PREFLIGHT-011", "/errors/PREFLIGHT/PREFLIGHT-011.md"], exitNonZero: false },
    },
    {
        code: "PREFLIGHT-012",
        title: "addMiddlewares missing from server/server.js",
        tier: "no-call-site",
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["PREFLIGHT-012", "/errors/PREFLIGHT/PREFLIGHT-012.md"] },
    },
    {
        code: "PREFLIGHT-013",
        title: "middleware export not a function",
        tier: "warn",
        break: (appDir) => {
            writeText(path.join(appDir, "server", "server.js"), "export const addMiddlewares = 123\n")
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeText(path.join(appDir, "server", "server.js"), "export function addMiddlewares(app) {}\n")
        },
        expect: { inOutput: ["PREFLIGHT-013", "/errors/PREFLIGHT/PREFLIGHT-013.md"], exitNonZero: false },
    },
    {
        code: "PREFLIGHT-014",
        title: "reducer missing from src/js/containers/App/reducer",
        tier: "no-call-site",
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["PREFLIGHT-014", "/errors/PREFLIGHT/PREFLIGHT-014.md"] },
    },
    {
        code: "PREFLIGHT-015",
        title: "reducer export not a function",
        tier: "no-call-site",
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["PREFLIGHT-015", "/errors/PREFLIGHT/PREFLIGHT-015.md"] },
    },
    {
        code: "PREFLIGHT-016",
        title: "configureStore missing from src/js/store/index.js",
        tier: "no-call-site",
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["PREFLIGHT-016", "/errors/PREFLIGHT/PREFLIGHT-016.md"] },
    },
    {
        code: "PREFLIGHT-017",
        title: "store default export not a function",
        tier: "warn",
        break: (appDir) => {
            writeText(path.join(appDir, "src", "js", "store", "index.js"), "export default 123\n")
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeText(
                path.join(appDir, "src", "js", "store", "index.js"),
                "const configureStore = (initialState) => ({ getState: () => ({ shellReducer: {} }), dispatch: () => {}, subscribe: () => () => {} })\nexport default configureStore\n"
            )
        },
        expect: { inOutput: ["PREFLIGHT-017", "/errors/PREFLIGHT/PREFLIGHT-017.md"], exitNonZero: false },
    },
    {
        code: "PREFLIGHT-018",
        title: "getRoutes missing from src/js/routes/utils.js",
        tier: "no-call-site",
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["PREFLIGHT-018", "/errors/PREFLIGHT/PREFLIGHT-018.md"] },
    },
    {
        code: "PREFLIGHT-019",
        title: "getRoutes not a function",
        tier: "warn",
        break: (appDir) => {
            writeText(
                path.join(appDir, "src", "js", "routes", "utils.js"),
                "import React from 'react'\nimport routes from './index.js'\nexport const preparedRoutes = () => routes\nexport const getRoutes = []\n"
            )
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeText(
                path.join(appDir, "src", "js", "routes", "utils.js"),
                "import React from 'react'\nimport routes from './index.js'\nexport const preparedRoutes = () => routes\nexport const getRoutes = () => routes\n"
            )
        },
        expect: { inOutput: ["PREFLIGHT-019", "/errors/PREFLIGHT/PREFLIGHT-019.md"], exitNonZero: false },
    },
    {
        code: "PREFLIGHT-020",
        title: "document missing from server/document.js",
        tier: "no-call-site",
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["PREFLIGHT-020", "/errors/PREFLIGHT/PREFLIGHT-020.md"] },
    },
    {
        code: "PREFLIGHT-021",
        title: "server/document.js default export not a function",
        tier: "warn",
        break: (appDir) => {
            writeText(path.join(appDir, "server", "document.js"), "export default 123\n")
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            writeText(
                path.join(appDir, "server", "document.js"),
                "import React from 'react'\nfunction Document(props) { return <html lang=\"en\"><head><meta charSet=\"utf-8\" /></head><body><div id=\"app\" /></body></html> }\nexport default Document\n"
            )
        },
        expect: { inOutput: ["PREFLIGHT-021", "/errors/PREFLIGHT/PREFLIGHT-021.md"], exitNonZero: false },
    },
]
