// swift-tools-version: 5.9
// Test harness only. The shipped sources are ios/*.swift, which the iOS build composes into the app
// (see manifest.json); this package compiles just the pure logic in ios/Support so it can be unit-tested
// with `swift test` — no simulator, no model, no LiteRT-LM download.
import PackageDescription

let package = Package(
    name: "CatalystAISupport",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [],
    dependencies: [
        .package(path: "../../../catalyst-core/src/native/iosnativeWebView/CoreLogic")
    ],
    targets: [
        .target(
            name: "AISupport",
            dependencies: [.product(name: "CatalystCoreLogic", package: "CoreLogic")],
            path: "ios/Support"
        ),
        .testTarget(
            name: "AISupportTests",
            dependencies: ["AISupport", .product(name: "CatalystCoreLogic", package: "CoreLogic")],
            path: "Tests/AISupportTests"
        ),
    ]
)
