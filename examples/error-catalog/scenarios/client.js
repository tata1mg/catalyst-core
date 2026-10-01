export const clientScenarios = [
    {
        code: "AI-004",
        title: "useNativeAI mounted in a plain web app — no window.NativeBridge",
        tier: "client",
        kind: "client",
        expect: { code: "AI-004", docSubstr: "AI/AI-004" },
    },
    {
        code: "RUNTIME-NATIVE-013",
        title: "Native bridge feature unavailable when hook invoked",
        tier: "client",
        kind: "client",
        expect: { code: "RUNTIME-NATIVE-013", docSubstr: "RUNTIME-NATIVE/RUNTIME-NATIVE-013" },
    },
    {
        code: "RUNTIME-NATIVE-014",
        title: "Native feature not supported on current platform",
        tier: "client",
        kind: "client",
        expect: { code: "RUNTIME-NATIVE-014", docSubstr: "RUNTIME-NATIVE/RUNTIME-NATIVE-014" },
    },
    {
        code: "RUNTIME-NATIVE-018",
        title: "WebBridge.callback() invoked with unregistered interface name",
        tier: "client",
        kind: "client",
        expect: { code: "RUNTIME-NATIVE-018", docSubstr: "RUNTIME-NATIVE/RUNTIME-NATIVE-018" },
    },
    {
        code: "RUNTIME-NATIVE-019",
        title: "WebBridge callback received before handler registered",
        tier: "client",
        kind: "client",
        expect: { code: "RUNTIME-NATIVE-019", docSubstr: "RUNTIME-NATIVE/RUNTIME-NATIVE-019" },
    },
    {
        code: "RUNTIME-NATIVE-020",
        title: "Registered WebBridge callback handler throws during execution",
        tier: "client",
        kind: "client",
        expect: { code: "RUNTIME-NATIVE-020", docSubstr: "RUNTIME-NATIVE/RUNTIME-NATIVE-020" },
    },
    {
        code: "RUNTIME-NATIVE-021",
        title: "WebBridge.register() called with invalid parameters",
        tier: "client",
        kind: "client",
        expect: { code: "RUNTIME-NATIVE-021", docSubstr: "RUNTIME-NATIVE/RUNTIME-NATIVE-021" },
    },
    {
        code: "RUNTIME-NATIVE-022",
        title: "WebBridge.init() called outside a browser environment",
        tier: "client",
        kind: "client",
        expect: { code: "RUNTIME-NATIVE-022", docSubstr: "RUNTIME-NATIVE/RUNTIME-NATIVE-022" },
    },
]

export default clientScenarios
