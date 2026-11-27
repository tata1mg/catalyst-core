import { afterEach, describe, expect, it, vi } from "vitest"
import { INTERFACE_CATEGORIES, NATIVE_COMMANDS, NATIVE_CALLBACKS, debugInterfaces, getInterfacesByCategory, isValidCallback, isValidCommand, isValidInterface } from "../../src/native/bridge/constants/NativeInterfaces"

afterEach(() => vi.restoreAllMocks())

describe("NativeInterfaces helpers", () => {
    it("getInterfacesByCategory is case-insensitive and throws for an unknown category", () => {
        expect(getInterfacesByCategory("camera")).toBe((INTERFACE_CATEGORIES as any).CAMERA)
        expect(getInterfacesByCategory("CAMERA").commands.length).toBeGreaterThan(0)
        expect(() => getInterfacesByCategory("nope")).toThrow("Invalid category: nope")
    })

    it("debugInterfaces prints the commands, callbacks and categories", () => {
        const group = vi.spyOn(console, "group").mockImplementation(() => {})
        const log = vi.spyOn(console, "log").mockImplementation(() => {})
        const groupEnd = vi.spyOn(console, "groupEnd").mockImplementation(() => {})
        debugInterfaces()
        expect(group).toHaveBeenCalled()
        expect(log.mock.calls.map((c) => c[0])).toEqual(["Commands:", "Callbacks:", "Categories:"])
        expect(groupEnd).toHaveBeenCalled()
    })

    it("validators accept known names only", () => {
        expect(isValidCommand((NATIVE_COMMANDS as any).OPEN_CAMERA)).toBe(true)
        expect(isValidCallback((NATIVE_CALLBACKS as any).ON_CAMERA_CAPTURE)).toBe(true)
        expect(isValidCommand("NOPE")).toBe(false)
        expect(isValidCallback("NOPE")).toBe(false)
        expect(isValidInterface("NOPE")).toBe(false)
    })
})
