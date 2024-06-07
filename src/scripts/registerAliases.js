import path from "path"
import moduleAlias from "module-alias"
import { _moduleAliases } from "../../package.json"

moduleAlias.addAliases(
    Object.keys(_moduleAliases || []).reduce((resultMap, aliasName) => {
        const aliasPath = _moduleAliases[aliasName]

        if (aliasName?.includes("@template")) {
            if (aliasName?.includes("server") && process.env.NODE_ENV === "production") {
                resultMap[aliasName] = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH)
            } else {
                resultMap[aliasName] = path.join(process.env.src_path, aliasPath)
            }
        }

        if (aliasName?.includes("@catalyst")) {
            if (aliasName?.includes("server") && process.env.NODE_ENV === "production") {
                resultMap[aliasName] = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH)
            } else {
                resultMap[aliasName] = path.join(__dirname, "../", aliasPath)
            }
        }

        return resultMap
    }, {})
)
