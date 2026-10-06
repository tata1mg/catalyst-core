# Vendored LiteRT-LM Swift wrapper

- Upstream: https://github.com/google-ai-edge/LiteRT-LM, tag `v0.17.1` (commit `5e58e9a0aef7abf7091207a8b1d1063a1c800f08`)
- Files: upstream `swift/*.swift` minus tests, `apple_fm`, `BUILD` and `Info.plist`; license in `LICENSE` (Apache-2.0).
- Binary: the release's `CLiteRTLM.xcframework.zip` (iOS device + Apple Silicon simulator), referenced by URL
  and checksum in `Package.swift` — nothing binary is committed.
- Why vendored: the upstream repo needs Git LFS and a ~2.7 GB clone to resolve as a Swift package.

Update with `../scripts/vendor-litertlm.sh <tag>` and re-run the on-device checks (stream semantics, Metal).
