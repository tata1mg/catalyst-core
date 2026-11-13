import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// describe/it/expect come from vitest's `globals: true` config (see vitest.config.mjs).
const {
    checkIfRoutePathExist,
    createDirectory,
    createNewRoute,
    createReducerEntryInStore,
    discardChanges,
    toCamelCase,
    validateComponentName,
    validatePath,
} = require("../codemod/new-route/utils.js")
const {
    createNewComponent,
    createReduxActionFile,
    createReduxReducerFile,
    createRTKReducerFile,
} = require("../codemod/new-route/template.js")

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

describe("new-route answers", () => {
    it("accepts a path, a parameter and a query", () => {
        expect(validatePath("/probe")).toBe(true)
        expect(validatePath("/probe/:id")).toBe(true)
        expect(validatePath("/probe?tab=1")).toBe(true)
    })

    it("says what is wrong with a path", () => {
        expect(validatePath("probe")).toMatch(/must start with a forward slash/)
        expect(validatePath("/probe/id")).toMatch(/Parameters must start/)
        expect(validatePath("/a?x!")).toMatch(/incorrectly formatted/)
    })

    it("wants a component name in PascalCase", () => {
        expect(validateComponentName("Probe")).toBe(true)
        expect(validateComponentName("probe")).toMatch(/uppercase/)
    })

    it("camel-cases a name for the reducer", () => {
        expect(toCamelCase("probe-page")).toBe("probePage")
        expect(toCamelCase("Probe Page")).toBe("probePage")
    })

    it("refuses a route or component the routes file already has", () => {
        expect(() => checkIfRoutePathExist({ routePath: "/fresh", componentName: "Fresh" })).not.toThrow()
        createNewRoute({
            componentName: "Probe",
            routePath: "/probe",
            routeTransformerPath: transformer("createRoute.js"),
        })
        expect(() => checkIfRoutePathExist({ routePath: "/probe", componentName: "Other" })).toThrow(
            /\/probe path already exist/
        )
        expect(() => checkIfRoutePathExist({ routePath: "/other", componentName: "Probe" })).toThrow(
            /Probe component path already exist/
        )
    })
})

describe("new-route files", () => {
    const containersDir = "src/js/containers"
    const folder = () => path.join(app, containersDir, "Probe")

    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => {})
    })
    afterEach(() => vi.restoreAllMocks())

    it("creates the component folder, and removes it again on failure", () => {
        expect(createDirectory({ componentName: "Probe", containersDir })).toBe(true)
        expect(fs.existsSync(folder())).toBe(true)
        discardChanges({ componentName: "Probe", containersDir })
        expect(fs.existsSync(folder())).toBe(false)
        // Nothing there: still fine.
        discardChanges({ componentName: "Probe", containersDir })
    })

    it("writes the component and a redux reducer for it", () => {
        fs.mkdirSync(folder(), { recursive: true })
        createNewComponent({ componentName: "Probe", containersDir })
        createReduxReducerFile({ componentName: "Probe", containersDir, reducerName: "probe" })
        expect(read(`${containersDir}/Probe/Probe.js`)).toContain("const Probe = () =>")
        expect(read(`${containersDir}/Probe/Probe.js`)).toContain("export default Probe")
        expect(read(`${containersDir}/Probe/reducer.js`)).toMatch(/probe/)
    })
})
