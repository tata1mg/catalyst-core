try {
    require.resolve("catalyst-core")
} catch (_) {
    // Non-fatal: in an npm workspace install, sibling packages aren't
    // guaranteed to be linked yet when preinstall runs, so this can be a
    // false positive. peerDependencies already declares the requirement;
    // npm warns/errors on its own if catalyst-core is genuinely missing
    // once the install finishes.
    console.warn("\n\x1b[33m[WARN] @catalyst/cloud-ai: catalyst-core not resolvable yet (expected during workspace install).\x1b[0m")
    console.warn("\x1b[33mIf this persists after install completes, run: npm install catalyst-core\x1b[0m\n")
}
