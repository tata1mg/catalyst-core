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
]

export default bundleScenarios
