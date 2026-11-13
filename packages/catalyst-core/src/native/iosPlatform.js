"use strict"

// Text mirrors errors/registry.js ERROR_DEFINITIONS[IOS-007] (see
// errors/IOS/IOS-007.md) — this CJS subtree can't import the ESM error registry
// (see buildErrorFormat.js), so the fields are duplicated here rather than imported.
function iosRequiresMacError() {
    return Object.assign(new Error("iOS builds need macOS and Xcode"), {
        code: "IOS-007",
        hint: "Build the iOS app on a Mac or a macOS CI runner. Plain catalyst buildApp and catalyst setupEmulator skip iOS on other systems and carry on with Android.",
        docUrl: "https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-007.md",
    })
}

module.exports = { iosRequiresMacError }
