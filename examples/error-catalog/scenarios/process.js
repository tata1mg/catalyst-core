import fs from "fs"
import path from "path"
import { BASELINE_FILES } from "./_baseline.js"

// Read from the committed server/index.js at module load — see _baseline.js.
const BASELINE_SERVER_INDEX = BASELINE_FILES["server/index.js"]

export const processScenarios = [
    {
        code: "PROCESS-001",
        title: "preServerInit hook throws during server startup",
        tier: "warn",
        kind: "cli-startup",
        break: (appDir) => {
            const serverIndexPath = path.join(appDir, "server", "index.js")
            fs.writeFileSync(
                serverIndexPath,
                `export function preServerInit() { throw new Error("boom from preServerInit") }\n`,
                "utf8"
            )
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            const serverIndexPath = path.join(appDir, "server", "index.js")
            fs.writeFileSync(serverIndexPath, BASELINE_SERVER_INDEX, "utf8")
        },
        expect: { inOutput: ["PROCESS-001", "PROCESS/PROCESS-001"], exitNonZero: false },
    },
    {
        code: "PROCESS-002",
        title: "User-defined hook onRouteMatch throws when invoked",
        tier: "warn",
        kind: "cli-startup",
        break: (appDir) => {
            const serverIndexPath = path.join(appDir, "server", "index.js")
            fs.writeFileSync(
                serverIndexPath,
                `export function preServerInit() {}\nexport function onRouteMatch() { throw new Error("boom from onRouteMatch") }\n`,
                "utf8"
            )
        },
        run: { cmd: "catalyst", args: ["start"], kind: "cli-startup" },
        restore: (appDir) => {
            const serverIndexPath = path.join(appDir, "server", "index.js")
            fs.writeFileSync(serverIndexPath, BASELINE_SERVER_INDEX, "utf8")
        },
        expect: { inOutput: ["PROCESS-002", "PROCESS/PROCESS-002"], exitNonZero: false },
    },
]

export default processScenarios
