import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { cspNonceMiddleware, generateNonce, isValidNonce } from "../../src/server/utils/cspNonce.js"

describe("cspNonceMiddleware", () => {
    const realEnv = process.env

    beforeEach(() => {
        // config.json booleans reach process.env as real booleans, because
        // loadEnvironmentVariables reassigns process.env with a plain object.
        process.env = { ...realEnv, CSP_NONCE_ENABLE: true as any }
    })

    afterEach(() => {
        process.env = realEnv
    })

    const run = (res: any) => {
        let nextCalls = 0
        cspNonceMiddleware({}, res, () => nextCalls++)
        return nextCalls
    }

    it("puts a valid nonce on res.locals.cspNonce and calls next", () => {
        const res: any = { locals: {} }
        expect(run(res)).toBe(1)
        expect(isValidNonce(res.locals.cspNonce)).toBe(true)
    })

    it("makes a new nonce for every request", () => {
        const first: any = { locals: {} }
        const second: any = { locals: {} }
        run(first)
        run(second)
        expect(first.locals.cspNonce).not.toBe(second.locals.cspNonce)
    })

    it("creates res.locals when the response has none", () => {
        const res: any = {}
        run(res)
        expect(isValidNonce(res.locals.cspNonce)).toBe(true)
    })

    it("leaves the response alone when CSP_NONCE_ENABLE is off, or is the string 'true'", () => {
        for (const value of [undefined, false, "true"]) {
            process.env = { ...realEnv, CSP_NONCE_ENABLE: value as any }
            const res: any = { locals: {} }
            expect(run(res)).toBe(1)
            expect(res.locals.cspNonce).toBeUndefined()
        }
    })

    it("lets the documented app middleware set a header that carries the nonce", () => {
        const headers: Record<string, string> = {}
        const res: any = { locals: {}, setHeader: (name: string, value: string) => (headers[name] = value) }
        // The example from the docs, registered in addMiddlewares.
        const appMiddleware = (_req: any, response: any, next: any) => {
            response.setHeader(
                "Content-Security-Policy",
                `script-src 'self' 'nonce-${response.locals.cspNonce}'`
            )
            next()
        }

        cspNonceMiddleware({}, res, () => appMiddleware({}, res, () => {}))

        expect(headers["Content-Security-Policy"]).toBe(`script-src 'self' 'nonce-${res.locals.cspNonce}'`)
        expect(headers["Content-Security-Policy"]).not.toContain("undefined")
    })

    it("is mounted before the app's middlewares in the server", () => {
        const source = fs.readFileSync(path.resolve(__dirname, "../../src/server/expressServer.ts"), "utf8")
        const nonceAt = source.indexOf("app.use(cspNonceMiddleware)")
        const appAt = source.indexOf("addMiddlewares(app)")
        expect(nonceAt).toBeGreaterThan(-1)
        expect(appAt).toBeGreaterThan(nonceAt)
    })
})

describe("isValidNonce", () => {
    it("accepts generated nonces and base64url values", () => {
        expect(isValidNonce(generateNonce())).toBe(true)
        expect(isValidNonce("abc_DEF-123")).toBe(true)
    })

    it("rejects values that could break out of an attribute, and non-strings", () => {
        for (const value of ['x" onload="alert(1)', "a b", "", undefined, null, 42]) {
            expect(isValidNonce(value)).toBe(false)
        }
    })
})
