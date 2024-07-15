const fs = require("fs")
const path = require("path")

const NAME = "chunk-groups-plugin"

class ChunkGroupPlugin {
    constructor({ filename = "chunk-groups.json" } = {}) {
        this.filename = filename
    }

    writeAssetsFile = (stats) => {
        try {
            const result = JSON.stringify(stats, null, 2)
            let statsPath = path.join(__dirname, `../../../`, "chunk-groups.json")
            if (process.env.NODE_ENV === "production") {
                statsPath = path.join(
                    process.env.src_path,
                    `${process.env.BUILD_OUTPUT_PATH}/public/chunk-groups.json`
                )
            }
            fs.writeFileSync(statsPath, result)
        } catch (err) {
            console.log("Error while creating stats file", err)
        }
    }

    apply(compiler) {
        compiler.hooks.done.tap(NAME, (stats) => {
            const statsJson = stats.toJson({
                all: false,
                chunkGroups: true,
            })
            this.writeAssetsFile(statsJson)
        })
    }
}

module.exports = ChunkGroupPlugin
