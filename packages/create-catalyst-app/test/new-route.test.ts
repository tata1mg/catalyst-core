import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// describe/it/expect come from vitest's `globals: true` config (see vitest.config.mjs).
const {
    createDirectory,
    createNewRoute,
    createReducerEntryInStore,
} = require("../codemod/new-route/utils.js")
const { createReduxActionFile, createRTKReducerFile } = require("../codemod/new-route/template.js")

const templates = path.resolve(__dirname, "..", "templates")
const originalCwd = process.cwd()
let app: string

beforeEach(() => {
    app = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst new route "))
    // A scaffolded app is the common template with the chosen one on top.
    for (const template of ["common", "redux-js"]) {
        fs.cpSync(path.join(templates, template, "src"), path.join(app, "src"), { recursive: true })
    }
    // The codemod works on paths relative to the app, as `npx create-catalyst-app new-route` does.
    process.chdir(app)
})

afterEach(() => {
    process.chdir(originalCwd)
    process.exitCode = undefined
    fs.rmSync(app, { recursive: true, force: true })
})

const read = (relative: string) => fs.readFileSync(path.join(app, relative), "utf8")
const transformer = (name: string) =>
    path.resolve(__dirname, "..", "codemod", "new-route", "transformers", name)

describe("new-route", () => {
    // Runs the real jscodeshift: on Windows its command name is a .cmd, which Node
    // refuses to spawn, and the failure left the route out while still exiting 0.
    it("adds the route to src/js/routes/index.js", () => {
        createNewRoute({
            componentName: "Probe",
            routePath: "/probe",
            routeTransformerPath: transformer("createRoute.js"),
        })
        expect(read("src/js/routes/index.js")).toContain("/probe")
        expect(read("src/js/routes/index.js")).toContain("Probe")
    })

    it("adds the reducer to src/js/store/index.js", () => {
        createReducerEntryInStore({
            componentName: "Probe",
            routePath: "/probe",
            reducerName: "probe",
            reducerTransformerPath: transformer("createReducer.js"),
        })
        expect(read("src/js/store/index.js")).toMatch(/probe/i)
    })

    // These used to refer to the variable they were declaring, which crashes the
    // whole app with a ReferenceError the moment the store loads.
    it("generates redux actions that load", () => {
        vi.spyOn(console, "log").mockImplementation(() => {})
        const containersDir = "src/js/containers"
        fs.mkdirSync(path.join(app, containersDir, "Probe"), { recursive: true })
        createReduxActionFile({ componentName: "Probe", containersDir, reducerName: "probe" })
        vi.restoreAllMocks()

        fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ type: "module" }))
        const url = pathToFileURL(path.join(app, containersDir, "Probe", "actions.js")).href
        const output = execFileSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `import { probeActions } from "${url}"; console.log(probeActions.REDUX_TEST)`,
            ],
            { encoding: "utf8" }
        )
        expect(output.trim()).toBe("probeActions/REDUX_TEST")
    })

    it("generates an RTK slice named with a string", () => {
        vi.spyOn(console, "log").mockImplementation(() => {})
        const containersDir = "src/js/containers"
        fs.mkdirSync(path.join(app, containersDir, "Probe"), { recursive: true })
        createRTKReducerFile({ componentName: "Probe", containersDir, reducerName: "probe" })
        vi.restoreAllMocks()
        expect(read(`${containersDir}/Probe/reducer.js`)).toContain('name: "probeReducer",')
    })

    it("exits non-zero when the component folder already exists", () => {
        vi.spyOn(console, "log").mockImplementation(() => {})
        const containersDir = "src/js/containers"
        fs.mkdirSync(path.join(app, containersDir, "Probe"), { recursive: true })
        expect(createDirectory({ componentName: "Probe", containersDir })).toBeUndefined()
        expect(process.exitCode).toBe(1)
        vi.restoreAllMocks()
    })
})
