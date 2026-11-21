import fs from "fs"
import path from "path"
import { BASELINE_FILES } from "./_baseline.js"

// Read from the committed Home.jsx at module load — see _baseline.js.
const BASELINE_HOME = BASELINE_FILES["src/js/containers/App/Home.jsx"]

export const bundleScenarios = [
    {
        code: "BUNDLE-000",
        title: "Syntax error in a source file during production build",
        tier: "build",
        kind: "build",
        break: (appDir) => {
            const homePath = path.join(appDir, "src", "js", "containers", "App", "Home.jsx")
            fs.writeFileSync(homePath, "export default function Home() { return <div> }\n", "utf8")
        },
        run: { cmd: "catalyst", args: ["build"], kind: "build" },
        restore: (appDir) => {
            const homePath = path.join(appDir, "src", "js", "containers", "App", "Home.jsx")
            fs.writeFileSync(homePath, BASELINE_HOME, "utf8")
        },
        expect: { inOutput: ["BUNDLE-000", "BUNDLE/BUNDLE-000"], exitNonZero: true },
    },
    ...[
        {
            code: "BUNDLE-001",
            title: "Import a name the module does not export",
            source: 'import { missingExport } from "./index.jsx"; export default missingExport;\n',
        },
        {
            code: "BUNDLE-002",
            title: "Import a file that does not exist",
            source: 'import missing from "./does-not-exist"; export default missing;\n',
        },
    ].map(({ code, title, source }) => ({
        code,
        title,
        tier: "build",
        kind: "build",
        break: (appDir) => {
            fs.writeFileSync(path.join(appDir, "src/js/containers/App/Home.jsx"), source, "utf8")
        },
        run: { cmd: "catalyst", args: ["build"], kind: "build" },
        restore: (appDir) => {
            fs.writeFileSync(path.join(appDir, "src/js/containers/App/Home.jsx"), BASELINE_HOME, "utf8")
        },
        expect: { inOutput: [code, `BUNDLE/${code}`], exitNonZero: true },
    })),
]

export default bundleScenarios
