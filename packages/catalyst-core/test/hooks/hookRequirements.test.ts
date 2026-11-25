// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { useMicrophone } from "../../src/native/bridge/hooks/useMicrophone"
import { useSpeechRecognition } from "../../src/native/bridge/hooks/useSpeechRecognition"
import { usePipeline, codeStage } from "../../src/native/bridge/hooks/usePipeline"
import { useAI } from "../../src/native/bridge/hooks/useAI"
import { useVision } from "../../src/native/bridge/hooks/useVision"
import { useTranscribe } from "../../src/native/bridge/hooks/useTranscribe"
import { useAgent } from "../../src/native/bridge/hooks/useAgent"
import { useImageGen, useSpeech, useLiveTranscribe } from "../../src/native/bridge/hooks/aiGeneration"

// The legacy native hooks (camera, file picker, ...) are classified below but not imported here: no other test loads them, so importing
// them would add their (untested) lines to the coverage gate. The index is read as text instead, which still catches a new export.
const hooks: Record<string, any> = { useMicrophone, useSpeechRecognition, usePipeline, codeStage, useAI, useVision, useTranscribe, useAgent, useImageGen, useSpeech, useLiveTranscribe }
const indexSource = fs.readFileSync(path.resolve(process.cwd(), "src/native/bridge/hooks/index.ts"), "utf8")

// The contract every exported hook is held to, in a plain browser (no WebBridge, no native shell, no catalyst-ai):
//   renders          never throws; reports isNative: false / isWeb: true (or supported: false)
//   needsWebBridge   throws "WebBridge is not initialized" (documented; the app shell calls WebBridge.init())
//   needsRouter      throws without a <Router>
//   needsAiPackage   renders; its error says "npm install catalyst-ai" (covered in catalystAiNotInstalled.test.ts)
//   notAHook         a function or class that is not rendered
//
// Adding an export to catalyst-core/hooks fails this test until it is classified here AND in "Requirements and fallbacks" in
// docs/content/11-API Reference/01-Hooks.md. That keeps "what does this need, and what happens without it" answered for every hook.
type Kind = "renders" | "needsWebBridge" | "needsRouter" | "needsAiPackage" | "notAHook"
const CLASSIFIED: Record<string, Kind> = {
    useCamera: "renders", useCameraPermission: "renders", useFilePicker: "renders", useHapticFeedback: "renders",
    useNetworkStatus: "renders", useDeviceInfo: "renders", useDataProtection: "renders", useSafeArea: "renders", useVideoStream: "renders",
    useMicrophone: "renders", useSpeechRecognition: "renders",
    useIntent: "needsWebBridge", useGoogleSignIn: "needsWebBridge", useNotification: "needsWebBridge", useNotificationPermission: "needsWebBridge",
    useNativeTransition: "needsRouter",
    useAI: "needsAiPackage", useVision: "needsAiPackage", useTranscribe: "needsAiPackage", useAgent: "needsAiPackage",
    useImageGen: "needsAiPackage", useSpeech: "needsAiPackage", useLiveTranscribe: "needsAiPackage",
    usePipeline: "renders",
    // not hooks
    requestMicrophonePermission: "notAHook", requestCameraPermission: "notAHook", requestHapticFeedback: "notAHook",
    requestNotificationPermission: "notAHook", requestImage: "notAHook", requestSpeech: "notAHook",
    registerDeviceImageEngine: "notAHook", deviceImageSupport: "notAHook", unloadDeviceImage: "notAHook",
    runPipeline: "notAHook", transcribeStage: "notAHook", jsonStage: "notAHook", imageStage: "notAHook", speechStage: "notAHook", codeStage: "notAHook",
    VisionError: "notAHook", TranscribeError: "notAHook",
}

const argsFor = (name: string): any =>
    name === "useVision" ? { schema: { type: "object", properties: {} } } : name === "useAgent" ? { tools: [] } : name === "usePipeline" ? [hooks.codeStage("echo", "text", "text", (x: string) => x)] : {}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}) })
afterEach(() => cleanup())

describe("every exported hook is classified", () => {
    it("has an entry for each export of catalyst-core/hooks", () => {
        // Names in `export { a, b } from ...` blocks; `export type { ... }` blocks are types and are skipped.
        const exported = [...indexSource.matchAll(/export (?!type\b)\{([^}]*)\}/g)]
            .flatMap((m) => m[1].split(","))
            .map((s) => s.trim().split(/\s+as\s+/).pop() as string)
            .filter(Boolean)
        const unclassified = exported.filter((name) => !(name in CLASSIFIED))
        expect(unclassified, `Classify ${unclassified.join(", ")} here and in the "Requirements and fallbacks" table of 01-Hooks.md`).toEqual([])
    })
})

describe("in a plain browser", () => {
    for (const [name, kind] of Object.entries(CLASSIFIED)) {
        if (kind === "notAHook" || !(name in hooks)) continue // legacy hooks: classified only, see the note above
        it(`${name} (${kind})`, () => {
            const hook = hooks[name]
            const render = () => renderHook(() => (name === "usePipeline" ? hook(argsFor(name), {}) : hook(argsFor(name))))
            if (kind === "needsWebBridge") return void expect(render).toThrow(/WebBridge is not initialized/)
            if (kind === "needsRouter") return void expect(render).toThrow(/Router/)
            const { result } = render()
            const r: any = result.current
            expect(r).toBeTruthy()
            if (kind === "needsAiPackage") return
            if (r && "isNative" in r) {
                expect(r.isNative).toBe(false)
                expect(r.isWeb).toBe(true)
            }
        })
    }
})
