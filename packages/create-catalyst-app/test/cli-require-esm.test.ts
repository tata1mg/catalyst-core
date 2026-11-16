// engines allows Node >=20.12, but require() of an ES module is only on by
// default from 20.19 / 22.12. On older runtimes a top-level require() of an
// ESM-only dependency (e.g. @clack/prompts) kills `npx create-catalyst-app`
// with ERR_REQUIRE_ESM before it prints anything. Simulate those runtimes by
// turning require(esm) off and check the CLI still starts.
const { spawnSync }: typeof import("child_process") = require("child_process")
const path: typeof import("path") = require("path")

const cli = path.join(__dirname, "..", "scripts", "cli.cjs")
const canDisableRequireEsm = process.allowedNodeEnvironmentFlags.has("--no-experimental-require-module")

describe.runIf(canDisableRequireEsm)("cli.cjs without require(esm)", () => {
    it("prints --help", () => {
        const result = spawnSync(process.execPath, ["--no-experimental-require-module", cli, "--help"], {
            encoding: "utf8",
        })
        expect(result.stderr).not.toContain("ERR_REQUIRE_ESM")
        expect(result.status).toBe(0)
        expect(result.stdout).toContain("Usage:")
    })

    it("loads the prompt library when scaffolding", () => {
        // An invalid name fails validation right after the prompt library is
        // imported, so nothing is created.
        const result = spawnSync(
            process.execPath,
            ["--no-experimental-require-module", cli, "Bad Name", "-y"],
            {
                encoding: "utf8",
                env: { ...process.env, NO_COLOR: "1" },
            }
        )
        const output = result.stdout + result.stderr
        expect(output).not.toContain("ERR_REQUIRE_ESM")
        expect(output).toContain("CCA-001")
        expect(result.status).toBe(1)
    })
})
