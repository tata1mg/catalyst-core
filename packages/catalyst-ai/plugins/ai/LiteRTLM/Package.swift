// swift-tools-version: 5.9
// Vendored from google-ai-edge/LiteRT-LM (Apache-2.0), tag v0.17.1 — see VENDORED.md.
// Upstream's repo tracks large Android/Linux/Windows libraries in Git LFS, which makes
// `swift package resolve` require git-lfs and clone ~2.7 GB. Vendoring only the Swift wrapper and
// pointing at the release's prebuilt xcframework avoids both; SwiftPM downloads just that ~120 MB zip.
import PackageDescription

let package = Package(
    name: "LiteRTLM",
    platforms: [
        .iOS(.v15)
    ],
    products: [
        .library(name: "LiteRTLM", targets: ["LiteRTLM"])
    ],
    targets: [
        .binaryTarget(
            name: "CLiteRTLM",
            url: "https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.17.1/CLiteRTLM.xcframework.zip",
            checksum: "c94fc12aa0403cb47208e419cc3bfe258214ea17035f7a63c16de536869f2186"
        ),
        .target(
            name: "LiteRTLM",
            dependencies: ["CLiteRTLM"],
            path: "Sources/LiteRTLM"
        ),
    ]
)
