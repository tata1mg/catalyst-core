import { describe, it, expect } from "vitest"
import { translateError, createStandardError } from "../../packages/catalyst-core/src/native/bridge/errors.js"
import { mappingScenarios } from "../scenarios/mapping.js"

describe("Mapping Scenarios (Kind F)", () => {
    for (const scen of mappingScenarios) {
        it(`${scen.code}: ${scen.title}`, () => {
            let err
            if (scen.nativeError !== undefined) {
                err = translateError(scen.nativeError)
            } else if (scen.createCode) {
                err = createStandardError(scen.createCode)
            }
            expect(err.code).toBe(scen.expect.code)
            expect(err.docUrl).toContain(scen.expect.docSubstr)
        })
    }
})
