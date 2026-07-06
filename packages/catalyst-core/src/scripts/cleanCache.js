const fs = require("fs")
const path = require("path")

function cleanCache() {
    const catalystCacheDir = path.join(process.cwd(), "node_modules/catalyst-core")
    const webpackCacheDir = path.join(catalystCacheDir, ".cache/webpack")
    const loadableStats = path.join(catalystCacheDir, "loadable-stats.json")

    let cleaned = false

    if (fs.existsSync(webpackCacheDir)) {
        fs.rmSync(webpackCacheDir, { recursive: true, force: true })
        console.log("[Catalyst] Removed webpack filesystem cache.")
        cleaned = true
    }

    if (fs.existsSync(loadableStats)) {
        fs.rmSync(loadableStats)
        console.log("[Catalyst] Removed loadable-stats.json.")
        cleaned = true
    }

    if (!cleaned) {
        console.log("[Catalyst] Nothing to clean — cache is already empty.")
    } else {
        console.log("[Catalyst] Clean complete. Next dev start will be a full rebuild.")
    }
}

cleanCache()
