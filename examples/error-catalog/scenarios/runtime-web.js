import fs from "fs"
import path from "path"
import { BASELINE_FILES } from "./_baseline.js"

// Baselines are read from the committed files at module load — see _baseline.js.
const BASELINE_APP_INDEX = BASELINE_FILES["src/js/containers/App/index.jsx"]
const BASELINE_DOCUMENT = BASELINE_FILES["server/document.js"]

export const runtimeWebScenarios = [
    {
        code: "RUNTIME-WEB-001",
        // A throwing document.js takes the SSR render path down. The
        // renderToPipeableStream onError callback fires RUNTIME-WEB-001 as the
        // first coded error of the request (RUNTIME-WEB-004 also fires from the
        // outer handler catch on the same request). NOTE: the same request
        // also mis-logs RUNTIME-WEB-002 and -003 on the 404-retry path even
        // though no fetcher or serverSideFunction failed — an SSR error-
        // attribution bug in handler.jsx, tracked separately.
        title: "SSR render fails (document.js throws) — onError fires RUNTIME-WEB-001",
        tier: "http",
        kind: "http",
        break: (appDir) => {
            const docPath = path.join(appDir, "server", "document.js")
            fs.writeFileSync(
                docPath,
                'import React from "react"\nexport default function Document() { throw new Error("Document render boom") }\n',
                "utf8"
            )
        },
        run: { kind: "http", path: "/", method: "GET" },
        restore: (appDir) => {
            const docPath = path.join(appDir, "server", "document.js")
            fs.writeFileSync(docPath, BASELINE_DOCUMENT, "utf8")
        },
        expect: { inOutput: ["RUNTIME-WEB-001", "RUNTIME-WEB/RUNTIME-WEB-001"] },
    },
    {
        code: "RUNTIME-WEB-003",
        title: "App.serverSideFunction throws",
        tier: "http",
        kind: "http",
        break: (appDir) => {
            const appIndexPath = path.join(appDir, "src", "js", "containers", "App", "index.jsx")
            fs.writeFileSync(
                appIndexPath,
                `import React from "react"\nimport Home from "./Home.jsx"\nexport default function App() { return <Home /> }\nApp.serverSideFunction = () => { throw new Error("serverSideFunction boom") }\n`,
                "utf8"
            )
        },
        run: { kind: "http", path: "/", method: "GET" },
        restore: (appDir) => {
            const appIndexPath = path.join(appDir, "src", "js", "containers", "App", "index.jsx")
            fs.writeFileSync(appIndexPath, BASELINE_APP_INDEX, "utf8")
        },
        expect: { inOutput: ["RUNTIME-WEB-003", "RUNTIME-WEB/RUNTIME-WEB-003"] },
    },
    {
        code: "RUNTIME-WEB-004",
        title: "server/document.js default export throws during document render",
        tier: "http",
        kind: "http",
        break: (appDir) => {
            const docPath = path.join(appDir, "server", "document.js")
            fs.writeFileSync(docPath, 'import React from "react"\nexport default function Document() { throw new Error("Document component boom") }\n', "utf8")
        },
        run: { kind: "http", path: "/", method: "GET" },
        restore: (appDir) => {
            const docPath = path.join(appDir, "server", "document.js")
            fs.writeFileSync(docPath, BASELINE_DOCUMENT, "utf8")
        },
        expect: { inOutput: ["RUNTIME-WEB-004", "RUNTIME-WEB/RUNTIME-WEB-004"] },
    },
]

export default runtimeWebScenarios
