import path from "path"
import moduleAlias from "module-alias"
import { _moduleAliases } from "../../package.json"
import { validateModuleAlias } from "./validator.js"
const { _moduleAliases: templateModuleAliases } = require(`${process.env.src_path}/package.json`)

export const catalystResultMap = Object.keys(_moduleAliases || []).reduce((resultMap, aliasName) => {
    const aliasPath = _moduleAliases[aliasName]

    if (aliasName?.includes("@catalyst/template")) {
        if (aliasName?.includes("server") && process.env.NODE_ENV === "production") {
            resultMap[aliasName] = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH)
        } else {
            resultMap[aliasName] = path.join(process.env.src_path, aliasPath)
        }
        return resultMap
    }

    if (aliasName?.includes("@catalyst") && !aliasName?.includes("@catalyst/template")) {
        if (aliasName?.includes("server") && process.env.NODE_ENV === "production") {
            resultMap[aliasName] = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH)
        } else {
            resultMap[aliasName] = path.join(__dirname, "../", aliasPath)
        }
        return resultMap
    }

    return resultMap
}, {})

moduleAlias.addAliases(catalystResultMap)

// resolves module alias imports
if (validateModuleAlias(templateModuleAliases)) {
    moduleAlias.addAliases(
        Object.keys(templateModuleAliases || []).reduce((resultMap, aliasName) => {
            const aliasPath = templateModuleAliases[aliasName]

            if (aliasPath.includes("server")) {
                if (process.env.NODE_ENV !== "production") {
                    resultMap[aliasName] = path.join(process.env.src_path, aliasPath)
                } else {
                    resultMap[aliasName] = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH)
                }
            } else resultMap[aliasName] = path.join(process.env.src_path, aliasPath)

            return resultMap
        }, {})
    )
}
