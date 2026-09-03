import path from "path"
import loadEnvironmentVariables from "./loadEnvironmentVariables.js"
import { validatePreInitServer, handleError, safeCallNamed } from "../server/utils/validator.js"

let preServerInit
try {
    const hooks = await import(path.join(process.env.src_path, "server/index.js"))
    preServerInit = hooks.preServerInit
} catch {
    // No hooks file — preServerInit remains undefined
}
await loadEnvironmentVariables()

// preServerInit is an OPTIONAL hook — an app with no server/index.js is
// valid, so PREFLIGHT-010 (missing) is deliberately not surfaced here. But
// if the app DID export something under that name and it isn't callable,
// that's a real mistake worth flagging (PREFLIGHT-011).
if (preServerInit !== undefined) {
    const preInitErr = validatePreInitServer(preServerInit)
    if (preInitErr) handleError(preInitErr)
}
await safeCallNamed("preServerInit", preServerInit)
