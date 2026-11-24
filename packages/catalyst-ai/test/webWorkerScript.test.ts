// The worker is a Blob script: resumableFetch.js is embedded into it with Function.toString(). These guard that
// embedding (a transpiler injecting a helper such as __name would break it only at runtime, inside a worker).
import vm from "node:vm"
import { WORKER_SCRIPT } from "../src/webWorkerScript.js"

describe("WORKER_SCRIPT", () => {
    it("parses as a script and carries the resumable fetch, self-contained", () => {
        expect(() => new vm.Script(WORKER_SCRIPT, { filename: "worker.js" })).not.toThrow()
        expect(WORKER_SCRIPT).toContain("function createResumableFetch")
        expect(WORKER_SCRIPT).toContain("function createOpfsStorage")
        expect(WORKER_SCRIPT).not.toContain("__name") // esbuild keepNames helper: undefined inside a Blob worker
        expect(WORKER_SCRIPT).not.toMatch(/\b_?(objectSpread|defineProperty|asyncToGenerator)\w*\(/) // other injected helpers
    })

    it("installs the resumable fetch right after each Transformers.js import", () => {
        expect(WORKER_SCRIPT.match(/await installResumableFetch\(mod\.env\)/g)).toHaveLength(2)
        expect(WORKER_SCRIPT).toContain("env.fetch = resumable.fetch")
    })

    it("runs: configure and network messages are handled before any generate, without throwing", async () => {
        const posted: any[] = []
        const sandbox: any = {
            self: { postMessage: (m: any) => posted.push(m), addEventListener() {}, isSecureContext: true },
            navigator: { onLine: true },
            console,
            setTimeout, clearTimeout,
            performance,
        }
        sandbox.self.self = sandbox.self
        vm.createContext(sandbox)
        vm.runInContext(WORKER_SCRIPT.replace(/\bself\.onmessage\s*=/, "globalThis.__onmessage ="), sandbox)
        const onmessage = sandbox.__onmessage
        expect(typeof onmessage).toBe("function")
        await onmessage({ data: { type: "configure", policy: { windowSec: 5 }, online: false } })
        await onmessage({ data: { type: "network", online: true } })
        await onmessage({ data: { type: "something-else" } })
        expect(posted).toEqual([]) // quiet: nothing to report until a model loads
    })
})
