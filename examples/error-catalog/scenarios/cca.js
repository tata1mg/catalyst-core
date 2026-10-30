import fs from "fs"
import path from "path"

export const ccaScenarios = [
    {
        code: "CCA-001",
        title: "Invalid project name provided to create-catalyst-app",
        tier: "cca-cli",
        kind: "cca-cli",
        cliArgs: ["Invalid Name!!"],
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["CCA-001", "CCA/CCA-001"], exitNonZero: true },
    },
    {
        code: "CCA-002",
        title: "Target directory already exists when running create-catalyst-app",
        tier: "cca-cli",
        kind: "cca-cli",
        cliArgs: ["existing-dir-app"],
        setupDir: (tmpDir) => {
            fs.mkdirSync(path.join(tmpDir, "existing-dir-app"), { recursive: true })
        },
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["CCA-002", "CCA/CCA-002"], exitNonZero: true },
    },
    // CCA-003 (invalid --lang) is in LEDGER: create-catalyst-app's
    // validateOptions() checks `cmd.lang` (scripts/cli.cjs ~L409, throws
    // CCA-003) but no `--lang` / `-l` Commander option is ever registered, so
    // `cmd.lang` is always undefined and the check is dead code. Not
    // reachable via the CLI without adding the option upstream.
    {
        code: "CCA-004",
        title: "Invalid --state-management option passed to create-catalyst-app",
        tier: "cca-cli",
        kind: "cca-cli",
        cliArgs: ["my-app", "--state-management", "flux", "-y"],
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["CCA-004", "CCA/CCA-004"], exitNonZero: true },
    },
    {
        code: "CCA-005",
        title: "Invalid value passed to --yes flag in create-catalyst-app",
        tier: "cca-cli",
        kind: "cca-cli",
        cliArgs: ["my-app", "--yes", "maybe"],
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["CCA-005", "CCA/CCA-005"], exitNonZero: true },
    },
    {
        code: "CCA-009",
        title: ".gitignore file already exists warning in create-catalyst-app",
        tier: "cca-cli",
        kind: "cca-cli",
        cliArgs: ["my-app", "-y"],
        break: () => {},
        restore: () => {},
        expect: { inOutput: ["CCA-009", "CCA/CCA-009"], exitNonZero: true },
    },
]

export default ccaScenarios
