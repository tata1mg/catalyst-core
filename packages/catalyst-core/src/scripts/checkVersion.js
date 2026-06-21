if (process.versions.node.split(".")[0] < 20) {
    console.error("\x1b[31m%s\x1b[0m", "use node version >=20")
}
