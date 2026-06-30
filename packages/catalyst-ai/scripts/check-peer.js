try {
    require.resolve("catalyst-core")
} catch (_) {
    console.error("\n\x1b[31m[ERROR] @catalyst/ai requires catalyst-core to be installed first.\x1b[0m")
    console.error("\x1b[33mRun: npm install catalyst-core\x1b[0m\n")
    process.exit(1)
}
