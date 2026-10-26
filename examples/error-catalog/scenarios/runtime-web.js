import fs from "fs"
import path from "path"
import { BASELINE_FILES } from "./_baseline.js"

// Baselines are read from the committed files at module load — see _baseline.js.
const BASELINE_APP_INDEX = BASELINE_FILES["src/js/containers/App/index.jsx"]
const BASELINE_DOCUMENT = BASELINE_FILES["server/document.js"]
const BASELINE_STORE = BASELINE_FILES["src/js/store/index.js"]

export const runtimeWebScenarios = [
    {
        code: "RUNTIME-WEB-001",
        // A throwing document.js takes the SSR render path down. The
        // renderToPipeableStream onError callback fires RUNTIME-WEB-001, and
        // handler.tsx reports a render failure once: the fetcher,
        // serverSideFunction and request catches it bubbles through no longer
        // re-log it as -002/-003/-004 (#535).
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
        // configureStore runs first in the request handler, outside the
        // render / fetcher / serverSideFunction catches, so its throw reaches
        // the top-level handler catch. (A throwing document.js used to reach
        // it too, but only as a re-log of the render failure, which is
        // RUNTIME-WEB-001 above.)
        title: "configureStore throws while handling a document request",
        tier: "http",
        kind: "http",
        break: (appDir) => {
            const storePath = path.join(appDir, "src", "js", "store", "index.js")
            fs.writeFileSync(storePath, 'const configureStore = () => { throw new Error("configureStore boom") }\nexport default configureStore\n', "utf8")
        },
        run: { kind: "http", path: "/", method: "GET" },
        restore: (appDir) => {
            const storePath = path.join(appDir, "src", "js", "store", "index.js")
            fs.writeFileSync(storePath, BASELINE_STORE, "utf8")
        },
        expect: { inOutput: ["RUNTIME-WEB-004", "RUNTIME-WEB/RUNTIME-WEB-004"] },
    },
]

export default runtimeWebScenarios
