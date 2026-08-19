import path from "path"
import loadEnvironmentVariables from "./loadEnvironmentVariables.js"
import { safeCallNamed } from "../server/utils/validator.js"

let preServerInit
try {
    const hooks = await import(path.join(process.env.src_path, "server/index.js"))
    preServerInit = hooks.preServerInit
} catch {
    // No hooks file — preServerInit remains undefined
}
await loadEnvironmentVariables()
await safeCallNamed("preServerInit", preServerInit)
