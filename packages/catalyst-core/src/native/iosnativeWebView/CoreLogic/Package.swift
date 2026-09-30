// swift-tools-version: 5.9
// Nested package for UIKit-free logic (#432).
// Static/checked-in — never generated. Unlike the parent Package.swift,
// this file has no config-dependent content (no plugin manifests, no
// notifications gate), so buildIos/plugins.js does not regenerate it.
//
// Kept as a genuinely separate SPM package (not a target inside the parent
// package) because `swift test`/`swift build` at the parent package root
// always resolves and builds every target in the graph regardless of
// --target/--filter scoping — verified directly: with CatalystCoreLogic as
// a target of the parent package, `swift test --filter
// BootTimingUtilityTests` still compiled CatalystCore and failed on
// `import UIKit`. A separate package with its own root sidesteps this:
// `swift test --package-path CoreLogic` only resolves this package's own
// graph (zero dependencies), never touches the parent package or its
// UIKit/GoogleSignIn-importing files.
import PackageDescription

let package = Package(
    name: "CatalystCoreLogic",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "CatalystCoreLogic", targets: ["CatalystCoreLogic"])
    ],
    targets: [
        .target(
            name: "CatalystCoreLogic",
            path: "Sources/CatalystCoreLogic"
        ),
        .testTarget(
            name: "CatalystCoreLogicTests",
            dependencies: ["CatalystCoreLogic"],
            path: "Tests/CatalystCoreLogicTests"
        )
    ]
)
